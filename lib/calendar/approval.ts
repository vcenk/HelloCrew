import { z } from "zod";

import type { CancelOutcome } from "./cancel";
import type { ConfirmOutcome } from "./confirm";
import type { BookingProposal } from "./tools";

/**
 * The bridge between a time the crew proposed and the approval the owner
 * decides on.
 *
 * A proposal only lives inside one agent turn. For the owner to approve it
 * later — from the dashboard, possibly hours afterwards — everything needed
 * to write the appointment has to survive in the approval row itself: which
 * slot, for what, and the idempotency key that stops a second write.
 *
 * Stored under the existing "booking" kind rather than a new one, so the
 * approvals a workspace without a calendar already creates keep working
 * untouched. The shape of `details` is what tells them apart.
 */
export const calendarApprovalSchema = z.object({
  calendar: z.literal(true),
  /**
   * What the owner is approving. Defaulted rather than required, so the
   * booking approvals already sitting in the database keep their meaning.
   */
  action: z.enum(["book", "cancel"]).default("book"),
  service: z.string().min(1),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  says: z.string().min(1),
  idempotencyKey: z.string().min(1),
  customerName: z.string().optional(),
});

export type CalendarApprovalDetails = z.infer<typeof calendarApprovalSchema>;

/** What goes into the approval row's `details`. */
export function calendarApprovalDetails(
  proposal: BookingProposal,
  action: CalendarApprovalDetails["action"] = "book",
): CalendarApprovalDetails {
  return {
    calendar: true,
    action,
    service: proposal.service,
    startsAt: proposal.start.toISOString(),
    endsAt: proposal.end.toISOString(),
    says: proposal.says,
    idempotencyKey: proposal.idempotencyKey,
    ...(proposal.customerName ? { customerName: proposal.customerName } : {}),
  };
}

/**
 * The proposal to confirm, or null when this approval is not a calendar one.
 *
 * Null is the ordinary case for a workspace with no calendar connected: its
 * bookings are approved and then entered by the owner, exactly as before.
 */
export function calendarApprovalAction(
  details: unknown,
): CalendarApprovalDetails["action"] | null {
  const parsed = calendarApprovalSchema.safeParse(details);
  return parsed.success ? parsed.data.action : null;
}

export function calendarProposalFromApproval(
  approvalId: string,
  details: unknown,
): BookingProposal | null {
  const parsed = calendarApprovalSchema.safeParse(details);
  if (!parsed.success) return null;

  const start = new Date(parsed.data.startsAt);
  const end = new Date(parsed.data.endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  return {
    id: approvalId,
    service: parsed.data.service,
    start,
    end,
    says: parsed.data.says,
    idempotencyKey: parsed.data.idempotencyKey,
    ...(parsed.data.customerName
      ? { customerName: parsed.data.customerName }
      : {}),
  };
}

/**
 * What the customer is told, which must match what actually happened.
 *
 * Only the "booked" branch says the appointment exists, and it only runs
 * after the calendar confirmed the write. Everything else says plainly that
 * it did not happen, rather than leaving the customer expecting a slot that
 * nobody holds.
 */
export function customerReplyFor(
  outcome: ConfirmOutcome,
  proposal: BookingProposal,
): string {
  switch (outcome.status) {
    case "booked":
      return `Good news: your booking for ${proposal.service} is confirmed for ${proposal.says}.`;
    case "owner_books":
      // Approved, but this calendar takes no writes from us. The owner enters
      // it themselves, so the customer is promised a confirmation, not a slot.
      return "Good news: the business approved your booking request. You’ll get a confirmation shortly.";
    case "no_longer_free":
      return `Sorry — ${proposal.says} was taken just before this was confirmed, so it isn’t booked. Would another time work?`;
    case "failed":
      return `Sorry, we couldn’t confirm ${proposal.says} just now, so it isn’t booked. The business will be in touch.`;
  }
}

/**
 * What the customer is told after a cancellation, which must match what
 * actually happened to the calendar.
 */
export function customerCancelReplyFor(
  outcome: CancelOutcome,
  proposal: BookingProposal,
): string {
  switch (outcome.status) {
    case "cancelled":
    case "already_gone":
      return `That's cancelled — ${proposal.says} is no longer booked. Just ask if you'd like another time.`;
    case "owner_cancels":
      // Nothing has moved yet: the owner removes it in their own system, so
      // the customer is promised a confirmation rather than a free slot.
      return "The business has approved your cancellation and will confirm it shortly.";
    case "failed":
      return `Sorry, we couldn't cancel ${proposal.says} just now, so it is still booked. The business will be in touch.`;
  }
}

/** What the owner sees in the dashboard, in the same honest terms. */
export function ownerNoteFor(outcome: ConfirmOutcome): string | undefined {
  switch (outcome.status) {
    case "booked":
      return undefined; // The card already shows it as approved.
    case "owner_books":
      return `Approved. ${outcome.reason}`;
    case "no_longer_free":
      return "That time was taken before you approved it. Nothing was booked.";
    case "failed":
      return `Approved, but not booked: ${outcome.reason}`;
  }
}

/** The owner's version, for a cancellation that did not go through. */
export function ownerCancelNoteFor(outcome: CancelOutcome): string | undefined {
  switch (outcome.status) {
    case "cancelled":
      return undefined; // The card already shows it as approved.
    case "already_gone":
      return "That appointment was already off the calendar.";
    case "owner_cancels":
      return `Approved. ${outcome.reason}`;
    case "failed":
      return `Approved, but not cancelled: ${outcome.reason}`;
  }
}
