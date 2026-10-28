import { cancelBooking } from "./cancel";
import { confirmBooking } from "./confirm";
import type { BookingProposal } from "./tools";
import type { CalendarAccount, CalendarAdapter, CreatedEvent } from "./types";

export type RescheduleOutcome =
  /** The new time is booked and the old one is off the calendar. */
  | { status: "moved"; event: CreatedEvent }
  /**
   * The new time is booked, but the old one could not be released. Said
   * plainly rather than hidden: the business now has two appointments and
   * needs to remove one.
   */
  | { status: "moved_old_remains"; event: CreatedEvent; reason: string }
  /** This provider takes no writes from us, so the owner moves it. */
  | { status: "owner_moves"; reason: string }
  /** The new time went while the owner was deciding. Nothing changed. */
  | { status: "no_longer_free" }
  /** Nothing was written. The original appointment still stands. */
  | { status: "failed"; reason: string };

/**
 * Moves an approved appointment to a different time.
 *
 * Books the new time before releasing the old one, deliberately. The other
 * order reads more naturally and is much worse: a cancellation that succeeds
 * followed by a booking that fails leaves the customer with no appointment
 * at all and nobody aware of it. This way the worst case is two appointments
 * on the calendar, which is visible, recoverable, and reported.
 */
export async function rescheduleBooking(options: {
  account: CalendarAccount;
  adapter: CalendarAdapter;
  from: BookingProposal;
  to: BookingProposal;
  now?: Date;
}): Promise<RescheduleOutcome> {
  const { account, adapter, from, to, now } = options;

  const booked = await confirmBooking({ account, adapter, proposal: to, now });
  if (booked.status === "owner_books")
    return { status: "owner_moves", reason: booked.reason };
  if (booked.status === "no_longer_free") return { status: "no_longer_free" };
  if (booked.status === "failed")
    return { status: "failed", reason: booked.reason };

  const released = await cancelBooking({
    account,
    adapter,
    idempotencyKey: from.idempotencyKey,
  });
  // An old appointment that had already gone is exactly what we wanted.
  if (released.status === "cancelled" || released.status === "already_gone")
    return { status: "moved", event: booked.event };

  return {
    status: "moved_old_remains",
    event: booked.event,
    reason:
      released.status === "failed"
        ? released.reason
        : released.reason ?? "the old time needs removing by hand.",
  };
}

/** What the owner should be told, in words that match what happened. */
export function describeReschedule(outcome: RescheduleOutcome): string {
  switch (outcome.status) {
    case "moved":
      return "Moved on the calendar.";
    case "moved_old_remains":
      return `Booked at the new time, but the old one is still on the calendar: ${outcome.reason}`;
    case "owner_moves":
      return `Approved. ${outcome.reason}`;
    case "no_longer_free":
      return "That new time was taken before this was approved. Nothing was changed.";
    case "failed":
      return `Not moved: ${outcome.reason}`;
  }
}
