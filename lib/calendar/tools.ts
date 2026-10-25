import { z } from "zod";

import type { AgentContext } from "@/lib/agent/context";
import type { ToolContract } from "@/lib/agent/tool-contract";
import { describeSlot, mergeBusy, proposeSlots } from "./slots";
import type { CalendarAccount, CalendarAdapter, Interval } from "./types";

/** How far ahead the crew will look when a customer asks for a time. */
const LOOKAHEAD_DAYS = 14;

export type BookingProposal = {
  id: string;
  service: string;
  start: Date;
  end: Date;
  customerName?: string;
  /** Carried through approval so a replay cannot book twice. */
  idempotencyKey: string;
};

export type CalendarTurnEffects = {
  proposals: BookingProposal[];
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
      const window = lookahead();
      // A calendar that cannot be read is never treated as empty: proposing
      // a time on top of a real appointment is worse than saying "I can't".
      const busy = mergeBusy(await adapter.readBusy(account, window));
      const slots = proposeSlots({
        window,
        busy,
        openingHours: account.openingHours,
        timeZone: account.timeZone,
        durationMinutes: durationMinutes ?? account.defaultDurationMinutes,
        now: now(),
        leadTimeMinutes: account.leadTimeMinutes,
        maxSlots: 3,
      });

      if (slots.length === 0)
        return "Nothing is free in the next two weeks. Offer to take their details so the business can come back with a time.";

      return JSON.stringify({
        timeZone: account.timeZone,
        options: slots.map((slot) => ({
          startsAt: slot.start.toISOString(),
          says: describeSlot(slot, account.timeZone),
        })),
        note: "Offer these exact times only. Do not invent another one.",
      });
    },
  };

  const proposeBooking: ToolContract<
    z.ZodObject<{
      service: z.ZodString;
      startsAt: z.ZodString;
      durationMinutes: z.ZodOptional<z.ZodNumber>;
      customerName: z.ZodOptional<z.ZodString>;
    }>
  > = {
    name: "propose_booking",
    description:
      "Send one of the available times to the business owner to approve. Only use a time returned by check_availability.",
    schema: z.object({
      service: z.string().trim().min(1).max(120),
      startsAt: z
        .string()
        .datetime()
        .describe("An ISO instant taken from check_availability"),
      durationMinutes: z.number().int().min(5).max(480).optional(),
      customerName: z.string().trim().max(80).optional(),
    }),
    effect: "needs_approval",
    scope: "conversation",
    approval: "owner",
    requires: "google_calendar",
    // The same service at the same instant is one booking, however many times
    // the request is retried or the approval replayed.
    idempotencyKey: ({ service, startsAt }) =>
      `calendar:${service.trim().toLowerCase()}:${new Date(startsAt).toISOString()}`,
    audit: { action: "calendar.booking_proposed", recordsPii: true },
    isEnabled: (context: AgentContext) => context.skills.booking === "ask",
    run: async ({ service, startsAt, durationMinutes, customerName }) => {
      const start = new Date(startsAt);
      if (Number.isNaN(start.getTime()))
        return "That time wasn't understood. Call check_availability and use one of the times it returns.";

      const minutes = durationMinutes ?? account.defaultDurationMinutes;
      const end = new Date(start.getTime() + minutes * 60_000);

      // The model does not get to invent a time. Re-check against the real
      // calendar, because the conversation may have taken a while.
      const busy = mergeBusy(
        await adapter.readBusy(account, { start, end }),
      );
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
