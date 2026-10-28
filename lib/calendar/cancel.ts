import type { CalendarAccount, CalendarAdapter } from "./types";
import { canCancel } from "./types";

export type CancelOutcome =
  /** HelloCrew took it off the calendar, and the provider confirmed. */
  | { status: "cancelled" }
  /**
   * There was nothing there: somebody had already removed it in the
   * calendar itself. The slot is free, which is what was asked for.
   */
  | { status: "already_gone" }
  /**
   * Approved, but this provider takes no writes from us, so the owner
   * cancels it in their own system. Fresha and Booksy land here.
   */
  | { status: "owner_cancels"; reason: string }
  /** The provider refused. Never reported to anyone as cancelled. */
  | { status: "failed"; reason: string };

/**
 * Takes an approved cancellation off the calendar.
 *
 * The mirror of confirmBooking, and held to the same rule: nothing here
 * reports success unless the provider confirmed it, because telling a
 * customer their appointment is cancelled while it still sits on the
 * calendar is how a business ends up with somebody turning up.
 */
export async function cancelBooking(options: {
  account: CalendarAccount;
  adapter: CalendarAdapter;
  idempotencyKey: string;
}): Promise<CancelOutcome> {
  const { account, adapter, idempotencyKey } = options;

  if (!canCancel(adapter))
    return {
      status: "owner_cancels",
      reason: `${adapter.provider} does not let HelloCrew change appointments, so it needs cancelling there.`,
    };

  try {
    return { status: await adapter.cancelEvent!(account, idempotencyKey) };
  } catch (error) {
    return {
      status: "failed",
      reason:
        error instanceof Error
          ? error.message
          : "The calendar could not be reached.",
    };
  }
}

/** What the owner should be told, in words that match what happened. */
export function describeCancellation(outcome: CancelOutcome): string {
  switch (outcome.status) {
    case "cancelled":
      return "Taken off the calendar.";
    case "already_gone":
      return "That time was already free.";
    case "owner_cancels":
      return `Approved. ${outcome.reason}`;
    case "failed":
      return `Not cancelled: ${outcome.reason}`;
  }
}
