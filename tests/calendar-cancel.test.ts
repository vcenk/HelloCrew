import { describe, expect, it, vi } from "vitest";

import {
  calendarApprovalAction,
  calendarApprovalDetails,
  calendarProposalFromApproval,
  customerCancelReplyFor,
  ownerCancelNoteFor,
} from "../lib/calendar/approval";
import { cancelBooking, describeCancellation } from "../lib/calendar/cancel";
import type { CancelOutcome } from "../lib/calendar/cancel";
import type { BookingProposal } from "../lib/calendar/tools";
import { canCancel } from "../lib/calendar/types";
import type { CalendarAccount, CalendarAdapter } from "../lib/calendar/types";

const account: CalendarAccount = {
  provider: "google_calendar",
  calendarId: "salon@example.com",
  timeZone: "Europe/London",
  openingHours: { 1: [{ opens: 540, closes: 1020 }] },
  defaultDurationMinutes: 60,
  leadTimeMinutes: 60,
};

const booking: BookingProposal = {
  id: "b1",
  service: "Haircut",
  start: new Date("2026-01-05T09:00:00Z"),
  end: new Date("2026-01-05T10:00:00Z"),
  says: "Monday 5 January at 09:00",
  idempotencyKey: "calendar:haircut:2026-01-05T09:00:00.000Z",
};

const adapterThat = (
  cancelEvent?: CalendarAdapter["cancelEvent"],
): CalendarAdapter => ({
  provider: "google_calendar",
  readBusy: vi.fn(async () => []),
  createEvent: vi.fn(async (_a, event) => ({
    externalId: "evt_1",
    start: event.start,
    end: event.end,
  })),
  ...(cancelEvent ? { cancelEvent } : {}),
});

describe("taking an appointment off the calendar", () => {
  it("reports cancelled only when the calendar confirmed it", async () => {
    const cancelEvent = vi.fn(async () => "cancelled" as const);
    const outcome = await cancelBooking({
      account,
      adapter: adapterThat(cancelEvent),
      idempotencyKey: booking.idempotencyKey,
    });

    expect(outcome.status).toBe("cancelled");
    expect(cancelEvent).toHaveBeenCalledWith(account, booking.idempotencyKey);
  });

  it("treats an appointment already gone as a success", async () => {
    // Somebody removed it in the calendar itself. The slot is free, which is
    // what was asked for — not an error to put in front of the owner.
    const outcome = await cancelBooking({
      account,
      adapter: adapterThat(async () => "already_gone"),
      idempotencyKey: booking.idempotencyKey,
    });
    expect(outcome.status).toBe("already_gone");
  });

  it("never reports cancelled when the provider refused", async () => {
    const outcome = await cancelBooking({
      account,
      adapter: adapterThat(async () => {
        throw new Error("Calendar unavailable");
      }),
      idempotencyKey: booking.idempotencyKey,
    });

    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed")
      expect(outcome.reason).toContain("Calendar unavailable");
  });

  it("hands back to the owner when the provider takes no writes", async () => {
    // Fresha and Booksy: the appointment is theirs to remove.
    const adapter = adapterThat();
    expect(canCancel(adapter)).toBe(false);
    const outcome = await cancelBooking({
      account,
      adapter,
      idempotencyKey: booking.idempotencyKey,
    });
    expect(outcome.status).toBe("owner_cancels");
  });

  it("cancelling twice settles the same way", async () => {
    // The first call removes it; the second finds nothing and must not read
    // as a failure to the owner or the customer.
    let gone = false;
    const adapter = adapterThat(async () => {
      if (gone) return "already_gone";
      gone = true;
      return "cancelled";
    });
    const first = await cancelBooking({
      account,
      adapter,
      idempotencyKey: booking.idempotencyKey,
    });
    const second = await cancelBooking({
      account,
      adapter,
      idempotencyKey: booking.idempotencyKey,
    });

    expect(first.status).toBe("cancelled");
    expect(second.status).toBe("already_gone");
    expect(customerCancelReplyFor(second, booking)).toBe(
      customerCancelReplyFor(first, booking),
    );
  });
});

describe("what a cancellation says", () => {
  const outcomes: Record<string, CancelOutcome> = {
    cancelled: { status: "cancelled" },
    already_gone: { status: "already_gone" },
    owner_cancels: { status: "owner_cancels", reason: "no write API." },
    failed: { status: "failed", reason: "the calendar could not be reached." },
  };

  it("tells the customer it is cancelled only when it is", () => {
    expect(customerCancelReplyFor(outcomes.cancelled, booking)).toMatch(
      /cancelled/i,
    );
    expect(customerCancelReplyFor(outcomes.cancelled, booking)).toContain(
      booking.says,
    );
  });

  it("says plainly that it is still booked when it failed", () => {
    const reply = customerCancelReplyFor(outcomes.failed, booking);
    expect(reply).toMatch(/still booked/i);
    expect(reply).not.toMatch(/is no longer booked/i);
  });

  it("promises only a confirmation when the owner cancels it themselves", () => {
    const reply = customerCancelReplyFor(outcomes.owner_cancels, booking);
    expect(reply).toMatch(/confirm/i);
    expect(reply).not.toMatch(/no longer booked/i);
  });

  it("fits the reply length the database accepts", () => {
    for (const outcome of Object.values(outcomes))
      expect(
        customerCancelReplyFor(outcome, booking).length,
      ).toBeLessThanOrEqual(600);
  });

  it("tells the owner when approving did not cancel anything", () => {
    expect(ownerCancelNoteFor(outcomes.cancelled)).toBeUndefined();
    expect(ownerCancelNoteFor(outcomes.failed)).toMatch(/not cancelled/i);
    expect(describeCancellation(outcomes.failed)).toMatch(/not cancelled/i);
  });
});

describe("a cancellation approval", () => {
  it("is recognisable as a cancellation, not a booking", () => {
    const details = calendarApprovalDetails(booking, "cancel");
    expect(calendarApprovalAction(details)).toBe("cancel");
  });

  it("still names the booking it cancels", () => {
    const details = calendarApprovalDetails(booking, "cancel");
    const back = calendarProposalFromApproval("approval-1", details)!;
    expect(back.idempotencyKey).toBe(booking.idempotencyKey);
    expect(back.says).toBe(booking.says);
  });

  it("reads approvals written before cancelling existed as bookings", () => {
    // Rows already in the database carry no action at all.
    const old: Record<string, unknown> = { ...calendarApprovalDetails(booking) };
    delete old.action;
    expect(calendarApprovalAction(old)).toBe("book");
    expect(calendarProposalFromApproval("approval-1", old)).not.toBeNull();
  });
});
