import { z } from "zod";

import type { AgentContext } from "@/lib/agent/context";
import type { ToolContract } from "@/lib/agent/tool-contract";
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
    z.ZodObject<{ durationMinutes: z.ZodOptional<z.ZodNumber> }>
  > = {
    name: "check_availability",
    description:
      "Find times the business is actually free, from its real calendar. Use before suggesting any time to a customer.",
    schema: z.object({
      durationMinutes: z.number().int().min(5).max(480).optional(),
    }),
    effect: "read_only",
    scope: "tenant",
    approval: "none",
    requires: "google_calendar",
    audit: { action: "calendar.availability", recordsPii: false },
    isEnabled: (context: AgentContext) => context.skills.booking !== "off",
    run: async ({ durationMinutes }) => {
      const slots = await optionsNow(
        durationMinutes ?? account.defaultDurationMinutes,
      );

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
      durationMinutes: z.ZodOptional<z.ZodNumber>;
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
      durationMinutes: z.number().int().min(5).max(480).optional(),
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
    run: async ({ service, option, durationMinutes, customerName }) => {
      const minutes = durationMinutes ?? account.defaultDurationMinutes;
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
        status: "awaiting_owner_approval",
        time: describeSlot({ start, end }, account.timeZone),
        note: "Tell the customer the time has been sent to the business to confirm. Do not say it is booked.",
      });
    },
  };

  return [checkAvailability, proposeBooking];
}
