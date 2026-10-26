import type { BookingProposal } from "./tools";
import type { CalendarAccount, CalendarAdapter, CreatedEvent } from "./types";
import { canWrite } from "./types";

export type ConfirmOutcome =
  /** HelloCrew wrote it, and the provider confirmed. */
  | { status: "booked"; event: CreatedEvent }
  /**
   * Approved, but this provider has no write API, so the owner books it in
   * their own system. Fresha and Booksy both land here.
   */
  | { status: "owner_books"; reason: string }
  /** The slot went while the owner was deciding. Nothing was written. */
  | { status: "no_longer_free" }
  /** The provider refused. Never reported to anyone as booked. */
  | { status: "failed"; reason: string };

/**
 * Turns an approved proposal into a real appointment.
 *
 * The only place in HelloCrew that writes to an outside calendar, and it runs
 * after a person said yes — never from the model's turn.
 *
 * Nothing here reports success unless the provider confirmed it. A stale
 * approval, a taken slot or a provider error all come back honestly so the
 * owner is told the truth rather than reassured.
 */
export async function confirmBooking(options: {
  account: CalendarAccount;
  adapter: CalendarAdapter;
  proposal: BookingProposal;
  now?: Date;
}): Promise<ConfirmOutcome> {
  const { account, adapter, proposal } = options;
  const now = options.now ?? new Date();

  if (!canWrite(adapter))
    return {
      status: "owner_books",
      reason: `${adapter.provider} does not let HelloCrew write appointments, so the time needs adding there.`,
    };

  try {
    // Before anything else: have we already written this one? An approval
    // can arrive twice — a double click, a retried webhook, a replayed
    // callback. Asking the calendar first is what makes the second pass
    // report the booking that exists instead of re-reading, finding our own
    // event in the way, and telling the owner nothing was booked.
    const already = await adapter.findEvent?.(
      account,
      proposal.idempotencyKey,
    );
    if (already) return { status: "booked", event: already };

    // An approval sitting unread until after the appointment is not an
    // approval. Checked after the lookup above, because an appointment we
    // did book stays booked even once its start time has passed.
    if (proposal.start.getTime() <= now.getTime())
      return { status: "no_longer_free" };

    // Re-read rather than trust the proposal: the owner may have approved
    // hours after the customer asked.
    const busy = await adapter.readBusy(account, {
      start: proposal.start,
      end: proposal.end,
    });
    const taken = busy.some(
      (interval) =>
        proposal.start < interval.end && interval.start < proposal.end,
    );
    if (taken) return { status: "no_longer_free" };

    const event = await adapter.createEvent!(account, {
      start: proposal.start,
      end: proposal.end,
      title: proposal.customerName
        ? `${proposal.service} — ${proposal.customerName}`
        : proposal.service,
      notes: "Approved in HelloCrew.",
      // Carried from the proposal, so approving twice writes once.
      idempotencyKey: proposal.idempotencyKey,
    });

    return { status: "booked", event };
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

/** What the owner should be told, in words that match what actually happened. */
export function describeOutcome(outcome: ConfirmOutcome): string {
  switch (outcome.status) {
    case "booked":
      return "Added to the calendar.";
    case "owner_books":
      return `Approved. ${outcome.reason}`;
    case "no_longer_free":
      return "That time was taken before this was approved. Nothing was booked.";
    case "failed":
      return `Not booked: ${outcome.reason}`;
  }
}
