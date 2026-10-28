import { z } from "zod";

import type { AgentContext } from "@/lib/agent/context";
import { AWAITING_APPROVAL, type ToolContract } from "@/lib/agent/tool-contract";
import { describeSlot, mergeBusy, proposeSlots } from "./slots";
import type { CalendarAccount, CalendarAdapter, Interval } from "./types";

/** How far ahead the crew will look when a customer asks for a time. */
const LOOKAHEAD_DAYS = 14;

/** How many times are offered at once, and the highest option number. */
const MAX_OPTIONS = 3;

/**
 * How a free slot is named between the two tools.
 *
 * Deliberately not a date. Given a datetime field, models write their own —
 * they repeat back the "09:15" they just said to the customer, lose the
 * timezone, and the call is rejected. A token like this cannot be composed
 * from a conversation: it can only be copied from check_availability, which
 * is exactly the guarantee the calendar is here to provide.
 */
export type BookingProposal = {
  id: string;
  service: string;
  start: Date;
  end: Date;
  customerName?: string;
  /**
   * The time in the business's own words, built where the timezone is known.
   * The owner's approval card and the customer's confirmation both use it,
   * so neither has to re-derive a local time from an instant.
   */
  says: string;
  /** Carried through approval so a replay cannot book twice. */
  idempotencyKey: string;
};

export type CalendarTurnEffects = {
  proposals: BookingProposal[];
  /**
   * The times check_availability offered during this turn.
   *
   * propose_booking picks from here by number rather than taking a time as
   * an argument. Any argument shaped like a time — an ISO string, a token —
   * is something a model will eventually write itself instead of copying,
   * and it did: three runs in a row, once producing a booking in January for
   * a customer who had been offered October. A small integer into a list the
   * calendar just produced cannot be invented into a different hour, and it
   * makes "check before you book" structural rather than an instruction.
   */
  offered: Interval[];
  /**
   * Appointments this conversation already has, loaded before the turn.
   *
   * The crew cannot cancel what it cannot see, and it must not go looking
   * through the calendar for something that matches a name — these are the
   * ones this customer actually booked through HelloCrew.
   */
  booked: BookingProposal[];
  /** Cancellations the customer asked for, waiting for the owner. */
  cancellations: BookingProposal[];
  /** Moves the customer asked for: which appointment, and where to. */
  reschedules: { from: BookingProposal; to: BookingProposal }[];
};

/**
 * The two calendar tools.
 *
 * Reading availability is free to run. Booking is not: `propose_booking` only
 * records what the customer asked for, and nothing reaches the calendar until
 * the owner approves. That is what lets this work against platforms with no
 * write API at all — the owner approves, and either HelloCrew writes it or
 * the owner books it in their own system.
 */
/**
 * How long a named service takes.
 *
 * Looked up from approved knowledge rather than taken as an argument. A
 * model handed a durationMinutes field will fill it in — and a colour
 * booked into a trim's half hour is a customer sitting in a chair that is
 * promised to somebody else. The owner sets the length once, with the
 * price; a service with none set keeps the workspace default.
 */
function serviceMinutes(
  context: AgentContext,
  account: CalendarAccount,
  service?: string,
): number {
  const wanted = service?.trim().toLowerCase();
  if (!wanted) return account.defaultDurationMinutes;
  const match = context.business.services.find(
    (candidate) => candidate.name.trim().toLowerCase() === wanted,
  );
  return match?.minutes ?? account.defaultDurationMinutes;
}

export function calendarContracts(options: {
  account: CalendarAccount;
  adapter: CalendarAdapter;
  effects: CalendarTurnEffects;
  now?: () => Date;
}): ToolContract[] {
  const { account, adapter, effects } = options;
  const now = options.now ?? (() => new Date());

  const lookahead = (): Interval => {
    const start = now();
    return {
      start,
      end: new Date(start.getTime() + LOOKAHEAD_DAYS * 86_400_000),
    };
  };

  /**
   * The times on offer right now, newest reading of the calendar.
   *
   * Shared so that propose_booking does not depend on check_availability
   * having run first. It did, and a real turn died of it: the model called
   * propose_booking, was told to check availability, checked it, and then
   * ran out of rounds — leaving the customer told their booking was being
   * requested and the owner with nothing to approve.
   */
  const optionsNow = async (minutes: number): Promise<Interval[]> => {
    const window = lookahead();
    // A calendar that cannot be read is never treated as empty: proposing a
    // time on top of a real appointment is worse than saying "I can't".
    const busy = mergeBusy(await adapter.readBusy(account, window));
    return proposeSlots({
      window,
      busy,
      openingHours: account.openingHours,
      timeZone: account.timeZone,
      durationMinutes: minutes,
      now: now(),
      leadTimeMinutes: account.leadTimeMinutes,
      maxSlots: MAX_OPTIONS,
    }).map((slot) => ({ start: slot.start, end: slot.end }));
  };

  const checkAvailability: ToolContract<
    z.ZodObject<{ service: z.ZodOptional<z.ZodString> }>
  > = {
    name: "check_availability",
    description:
      "Find times the business is actually free, from its real calendar. Use before suggesting any time to a customer.",
    schema: z.object({
      service: z
        .string()
        .trim()
        .max(120)
        .optional()
        .describe(
          "The service the customer asked about, named as the business names it. Its length decides how long a slot has to be.",
        ),
    }),
    effect: "read_only",
    scope: "tenant",
    approval: "none",
    requires: "google_calendar",
    audit: { action: "calendar.availability", recordsPii: false },
    isEnabled: (context: AgentContext) => context.skills.booking !== "off",
    run: async ({ service }, context) => {
      const slots = await optionsNow(serviceMinutes(context, account, service));

      if (slots.length === 0)
        return "Nothing is free in the next two weeks. Offer to take their details so the business can come back with a time.";

      effects.offered = slots;

      return JSON.stringify({
        timeZone: account.timeZone,
        options: slots.map((slot, index) => ({
          option: index + 1,
          says: describeSlot(slot, account.timeZone),
        })),
        note: "Offer these exact times only, using `says` to word them. Do not invent another one. To book one, call propose_booking with that option's `option` number.",
      });
    },
  };

  const proposeBooking: ToolContract<
    z.ZodObject<{
      service: z.ZodString;
      option: z.ZodNumber;
      customerName: z.ZodOptional<z.ZodString>;
    }>
  > = {
    name: "propose_booking",
    description:
      "Send one of the available times to the business owner to approve. Only use a time returned by check_availability.",
    schema: z.object({
      service: z.string().trim().min(1).max(120),
      option: z
        .number()
        .int()
        .min(1)
        .max(MAX_OPTIONS)
        .describe(
          "The `option` number of the time the customer chose, as check_availability numbered it",
        ),
      customerName: z.string().trim().max(80).optional(),
    }),
    effect: "needs_approval",
    scope: "conversation",
    approval: "owner",
    requires: "google_calendar",
    // The same service at the same instant is one booking, however many times
    // the request is retried or the approval replayed.
    // Resolved from the offered list, so the key names the real instant
    // rather than the option number, which means nothing outside this turn.
    idempotencyKey: ({ service, option }) =>
      `calendar:${service.trim().toLowerCase()}:${
        effects.offered[option - 1]?.start.toISOString() ?? `option-${option}`
      }`,
    audit: { action: "calendar.booking_proposed", recordsPii: true },
    isEnabled: (context: AgentContext) => context.skills.booking === "ask",
    run: async ({ service, option, customerName }, context) => {
      const minutes = serviceMinutes(context, account, service);
      // Works whether or not check_availability ran first in this turn, so a
      // model that books straight away does not have to spend a round being
      // told to look. The list is the same either way: it comes from the
      // calendar, never from the conversation.
      const offered =
        effects.offered.length > 0
          ? effects.offered
          : (effects.offered = await optionsNow(minutes));

      const chosen = offered[option - 1];
      if (!chosen)
        return offered.length === 0
          ? "Nothing is free in the next two weeks. Offer to take their details so the business can come back with a time."
          : `There is no option ${option}. The times on offer are: ${offered
              .map(
                (slot, index) =>
                  `${index + 1}. ${describeSlot(slot, account.timeZone)}`,
              )
              .join("; ")}.`;

      const start = chosen.start;
      const end = new Date(start.getTime() + minutes * 60_000);

      // Re-read rather than trust the list: the conversation may have taken
      // a while, and a slot that went in the meantime must not be proposed.
      const busy = mergeBusy(await adapter.readBusy(account, { start, end }));
      if (busy.some((taken) => start < taken.end && taken.start < end))
        return "That time has just been taken. Call check_availability again and offer a different one.";

      // The times on offer may have been worked out for a different service:
      // a half-hour trim's slot is not a two-hour colour's slot, and nothing
      // above would notice the colour running an hour past closing, because
      // time after closing is not busy — it simply is not offered.
      const [fits] = proposeSlots({
        window: { start, end },
        busy,
        openingHours: account.openingHours,
        timeZone: account.timeZone,
        durationMinutes: minutes,
        leadTimeMinutes: account.leadTimeMinutes,
        now: now(),
        maxSlots: 1,
      });
      if (!fits || fits.start.getTime() !== start.getTime())
        return `${service} takes ${minutes} minutes, which does not fit that time. Call check_availability naming the service, and offer one of the times it returns.`;

      if (effects.proposals.length >= 1)
        return "A time is already waiting for the owner on this conversation.";

      effects.proposals.push({
        id: crypto.randomUUID(),
        service,
        start,
        end,
        customerName,
        says: describeSlot({ start, end }, account.timeZone),
        idempotencyKey: `calendar:${service.trim().toLowerCase()}:${start.toISOString()}`,
      });

      return JSON.stringify({
        status: AWAITING_APPROVAL,
        time: describeSlot({ start, end }, account.timeZone),
        note: "Tell the customer the time has been sent to the business to confirm. Do not say it is booked.",
      });
    },
  };

  const cancelBookingTool: ToolContract<
    z.ZodObject<{ booking: z.ZodNumber }>
  > = {
    name: "cancel_booking",
    description:
      "Ask the business to cancel an appointment this customer already has. Only for a booking listed in your appointments.",
    schema: z.object({
      booking: z
        .number()
        .int()
        .min(1)
        .describe(
          "The number of the appointment to cancel, as the appointments list numbers them",
        ),
    }),
    effect: "needs_approval",
    scope: "conversation",
    approval: "owner",
    requires: "google_calendar",
    // Cancelling the same appointment twice is one cancellation, however
    // many times the request is retried or the approval replayed.
    idempotencyKey: ({ booking }) =>
      `calendar:cancel:${effects.booked[booking - 1]?.idempotencyKey ?? booking}`,
    audit: { action: "calendar.cancel_requested", recordsPii: true },
    isEnabled: (context: AgentContext) => context.skills.booking === "ask",
    run: ({ booking }) => {
      const chosen = effects.booked[booking - 1];
      if (!chosen)
        return effects.booked.length === 0
          ? "This customer has no appointments booked through us. Do not cancel anything; offer to pass them to a person."
          : `There is no appointment ${booking}. They have: ${effects.booked
              .map((appointment, index) => `${index + 1}. ${appointment.says}`)
              .join("; ")}.`;

      if (effects.cancellations.some((c) => c.id === chosen.id))
        return "That cancellation is already waiting for the owner.";

      effects.cancellations.push(chosen);

      return JSON.stringify({
        status: AWAITING_APPROVAL,
        time: chosen.says,
        note: "Tell the customer the cancellation has been sent to the business to confirm. Do not say it is cancelled.",
      });
    },
  };

  const rescheduleBookingTool: ToolContract<
    z.ZodObject<{ booking: z.ZodNumber; option: z.ZodNumber }>
  > = {
    name: "reschedule_booking",
    description:
      "Ask the business to move an appointment this customer already has to one of the free times. Call check_availability first so they can choose.",
    schema: z.object({
      booking: z
        .number()
        .int()
        .min(1)
        .describe("The number of the appointment to move"),
      option: z
        .number()
        .int()
        .min(1)
        .max(MAX_OPTIONS)
        .describe("The `option` number of the time it is moving to"),
    }),
    effect: "needs_approval",
    scope: "conversation",
    approval: "owner",
    requires: "google_calendar",
    // One move of one appointment to one time, however many times it is
    // retried or the approval replayed.
    idempotencyKey: ({ booking, option }) =>
      `calendar:move:${effects.booked[booking - 1]?.idempotencyKey ?? booking}:${
        effects.offered[option - 1]?.start.toISOString() ?? option
      }`,
    audit: { action: "calendar.reschedule_requested", recordsPii: true },
    isEnabled: (context: AgentContext) => context.skills.booking === "ask",
    run: async ({ booking, option }) => {
      const from = effects.booked[booking - 1];
      if (!from)
        return effects.booked.length === 0
          ? "This customer has no appointments booked through us. Do not move anything; offer to pass them to a person."
          : `There is no appointment ${booking}. They have: ${effects.booked
              .map((appointment, index) => `${index + 1}. ${appointment.says}`)
              .join("; ")}.`;

      const minutes = from.end.getTime() - from.start.getTime();
      const offered =
        effects.offered.length > 0
          ? effects.offered
          : (effects.offered = await optionsNow(minutes / 60_000));
      const slot = offered[option - 1];
      if (!slot)
        return offered.length === 0
          ? "Nothing is free in the next two weeks to move them to."
          : `There is no option ${option}. The times on offer are: ${offered
              .map(
                (candidate, index) =>
                  `${index + 1}. ${describeSlot(candidate, account.timeZone)}`,
              )
              .join("; ")}.`;

      if (slot.start.getTime() === from.start.getTime())
        return "That is the time they already have. Offer a different one.";

      if (effects.reschedules.some((move) => move.from.id === from.id))
        return "That change is already waiting for the owner.";

      const to: BookingProposal = {
        id: crypto.randomUUID(),
        service: from.service,
        start: slot.start,
        end: new Date(slot.start.getTime() + minutes),
        says: describeSlot(
          { start: slot.start, end: new Date(slot.start.getTime() + minutes) },
          account.timeZone,
        ),
        ...(from.customerName ? { customerName: from.customerName } : {}),
        idempotencyKey: `calendar:${from.service.trim().toLowerCase()}:${slot.start.toISOString()}`,
      };

      effects.reschedules.push({ from, to });

      return JSON.stringify({
        status: AWAITING_APPROVAL,
        from: from.says,
        to: to.says,
        note: "Tell the customer the change has been sent to the business to confirm. Do not say it is moved.",
      });
    },
  };

  return [
    checkAvailability,
    proposeBooking,
    cancelBookingTool,
    rescheduleBookingTool,
  ];
}
