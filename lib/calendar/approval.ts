import { z } from "zod";

import type { CancelOutcome } from "./cancel";
import type { ConfirmOutcome } from "./confirm";
import type { RescheduleOutcome } from "./reschedule";
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
  action: z.enum(["book", "cancel", "reschedule"]).default("book"),
  /**
   * For a reschedule, the appointment being moved. The fields above
   * describe where it is moving to, so one approval carries both halves and
   * neither can be lost between the crew's turn and the owner's decision.
   */
  replaces: z
    .object({ idempotencyKey: z.string().min(1), says: z.string().min(1) })
    .optional(),
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
  replaces?: BookingProposal,
): CalendarApprovalDetails {
  return {
    calendar: true,
    action,
    ...(replaces
      ? {
          replaces: {
            idempotencyKey: replaces.idempotencyKey,
            says: replaces.says,
          },
        }
      : {}),
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

/** The appointment a reschedule approval is moving, if it is one. */
export function calendarApprovalReplaces(
  details: unknown,
): { idempotencyKey: string; says: string } | null {
  const parsed = calendarApprovalSchema.safeParse(details);
  return parsed.success ? (parsed.data.replaces ?? null) : null;
}

/** What the customer is told after a reschedule, matching what happened. */
export function customerRescheduleReplyFor(
  outcome: RescheduleOutcome,
  to: BookingProposal,
  from: { says: string },
): string {
  switch (outcome.status) {
    case "moved":
    case "moved_old_remains":
      // The customer's appointment is at the new time either way. Whether
      // the old slot was released is the business's problem, not theirs.
      return `Done — you're moved from ${from.says} to ${to.says}.`;
    case "owner_moves":
      return "The business has approved the change and will confirm it shortly.";
    case "no_longer_free":
      return `Sorry, ${to.says} was taken just before this was approved, so you are still booked for ${from.says}. Would another time work?`;
    case "failed":
      return `Sorry, we couldn't move you to ${to.says} just now, so you are still booked for ${from.says}. The business will be in touch.`;
  }
}

/** The owner's version, for a move that did not go cleanly. */
export function ownerRescheduleNoteFor(
  outcome: RescheduleOutcome,
): string | undefined {
  switch (outcome.status) {
    case "moved":
      return undefined; // The card already shows it as approved.
    case "moved_old_remains":
      return `Booked at the new time, but the old one is still on your calendar: ${outcome.reason}`;
    case "owner_moves":
      return `Approved. ${outcome.reason}`;
    case "no_longer_free":
      return "That new time was taken before you approved it. Nothing was changed.";
    case "failed":
      return `Approved, but not moved: ${outcome.reason}`;
  }
}

/**
 * The appointments a conversation currently has, folded from its approvals.
 *
 * The approvals are a log, not a list: a move replaces what it moved and a
 * cancellation removes it, so only replaying them in order gives the state
 * the crew should act on. Counting bookings alone left the crew offering to
 * cancel a time that had already been moved away from.
 *
 * Rows must be the approved ones, oldest first.
 */
export function foldBookings(
  rows: { id: string; details: unknown }[],
  now = new Date(),
): BookingProposal[] {
  const live = new Map<string, BookingProposal>();

  for (const row of rows) {
    const action = calendarApprovalAction(row.details);
    if (!action) continue;
    const proposal = calendarProposalFromApproval(row.id, row.details);
    if (!proposal) continue;

    if (action === "book") live.set(proposal.idempotencyKey, proposal);
    else if (action === "cancel") live.delete(proposal.idempotencyKey);
    else if (action === "reschedule") {
      const replaced = calendarApprovalReplaces(row.details);
      if (replaced) live.delete(replaced.idempotencyKey);
      live.set(proposal.idempotencyKey, proposal);
    }
  }

  // Nothing that has already happened: it cannot be cancelled or moved.
  return [...live.values()].filter(
    (proposal) => proposal.start.getTime() > now.getTime(),
  );
}
