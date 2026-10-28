import { describe, expect, it, vi } from "vitest";

import {
  calendarApprovalAction,
  calendarApprovalDetails,
  calendarApprovalReplaces,
  calendarProposalFromApproval,
  customerCancelReplyFor,
  customerRescheduleReplyFor,
  foldBookings,
  ownerCancelNoteFor,
  ownerRescheduleNoteFor,
} from "../lib/calendar/approval";
import { cancelBooking, describeCancellation } from "../lib/calendar/cancel";
import {
  describeReschedule,
  rescheduleBooking,
} from "../lib/calendar/reschedule";
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

describe("moving an appointment", () => {
  // Before both fixtures, so the appointments are still ahead of us.
  const now = new Date("2026-01-04T00:00:00Z");
  const to: BookingProposal = {
    ...booking,
    id: "b2",
    start: new Date("2026-01-05T11:00:00Z"),
    end: new Date("2026-01-05T12:00:00Z"),
    says: "Monday 5 January at 11:00",
    idempotencyKey: "calendar:haircut:2026-01-05T11:00:00.000Z",
  };

  /** Records the order the two halves ran in. */
  function movingAdapter(over: Partial<CalendarAdapter> = {}) {
    const order: string[] = [];
    const adapter: CalendarAdapter = {
      provider: "google_calendar",
      readBusy: vi.fn(async () => []),
      findEvent: vi.fn(async () => null),
      createEvent: vi.fn(async (_a, event) => {
        order.push("create");
        return { externalId: "evt_new", start: event.start, end: event.end };
      }),
      cancelEvent: vi.fn(async () => {
        order.push("cancel");
        return "cancelled" as const;
      }),
      ...over,
    };
    return { adapter, order };
  }

  it("books the new time before releasing the old one", async () => {
    // The other order loses the customer's appointment outright when the
    // booking half fails, and nobody finds out.
    const { adapter, order } = movingAdapter();
    const outcome = await rescheduleBooking({ account, adapter, from: booking, to, now });

    expect(outcome.status).toBe("moved");
    expect(order).toEqual(["create", "cancel"]);
  });

  it("leaves the original alone when the new time cannot be booked", async () => {
    const { adapter } = movingAdapter({
      createEvent: vi.fn(async () => {
        throw new Error("Calendar unavailable");
      }),
    });
    const outcome = await rescheduleBooking({ account, adapter, from: booking, to, now });

    expect(outcome.status).toBe("failed");
    expect(adapter.cancelEvent).not.toHaveBeenCalled();
  });

  it("says so when the new time was booked but the old one stayed", async () => {
    // Two appointments is bad, and hiding it is worse.
    const { adapter } = movingAdapter({
      cancelEvent: vi.fn(async () => {
        throw new Error("Permission denied");
      }),
    });
    const outcome = await rescheduleBooking({ account, adapter, from: booking, to, now });

    expect(outcome.status).toBe("moved_old_remains");
    expect(describeReschedule(outcome)).toMatch(/still on the calendar/i);
    expect(ownerRescheduleNoteFor(outcome)).toMatch(/still on your calendar/i);
  });

  it("counts an old appointment already gone as a clean move", async () => {
    const { adapter } = movingAdapter({
      cancelEvent: vi.fn(async () => "already_gone" as const),
    });
    expect(
      (await rescheduleBooking({ account, adapter, from: booking, to, now }))
        .status,
    ).toBe("moved");
  });

  it("tells the customer the new time, both ways it can land", async () => {
    for (const status of ["moved", "moved_old_remains"] as const) {
      const outcome =
        status === "moved"
          ? { status, event: { externalId: "e", start: to.start, end: to.end } }
          : {
              status,
              event: { externalId: "e", start: to.start, end: to.end },
              reason: "permission denied",
            };
      const reply = customerRescheduleReplyFor(outcome, to, booking);
      expect(reply).toContain(to.says);
      expect(reply).toContain(booking.says);
    }
  });

  it("says they are still on the old time when the move failed", async () => {
    const reply = customerRescheduleReplyFor(
      { status: "failed", reason: "unreachable" },
      to,
      booking,
    );
    expect(reply).toContain(booking.says);
    expect(reply).toMatch(/still booked/i);
  });

  it("carries both halves in one approval", () => {
    const details = calendarApprovalDetails(to, "reschedule", booking);
    expect(calendarApprovalAction(details)).toBe("reschedule");
    expect(calendarApprovalReplaces(details)?.idempotencyKey).toBe(
      booking.idempotencyKey,
    );
    expect(calendarProposalFromApproval("a1", details)?.idempotencyKey).toBe(
      to.idempotencyKey,
    );
  });
});

/**
 * Found by driving a real conversation: after a move, the crew was still
 * being shown the time the customer had moved away from, and knew nothing
 * about the one they actually had — so a cancellation went to a person
 * instead. The approvals are a log, and only replaying them gives the state.
 */
describe("what a conversation currently has booked", () => {
  const later: BookingProposal = {
    ...booking,
    id: "b2",
    start: new Date("2026-01-05T13:00:00Z"),
    end: new Date("2026-01-05T14:00:00Z"),
    says: "Monday 5 January at 13:00",
    idempotencyKey: "calendar:haircut:2026-01-05T13:00:00.000Z",
  };
  const before = new Date("2026-01-04T00:00:00Z");
  const row = (
    id: string,
    proposal: BookingProposal,
    action?: "cancel" | "reschedule",
    replaces?: BookingProposal,
  ) => ({ id, details: calendarApprovalDetails(proposal, action, replaces) });

  it("lists a booking that was approved", () => {
    const live = foldBookings([row("1", booking)], before);
    expect(live.map((b) => b.says)).toEqual([booking.says]);
  });

  it("shows the new time after a move, not the old one", () => {
    const live = foldBookings(
      [row("1", booking), row("2", later, "reschedule", booking)],
      before,
    );
    expect(live.map((b) => b.says)).toEqual([later.says]);
  });

  it("drops a booking that was cancelled", () => {
    expect(
      foldBookings([row("1", booking), row("2", booking, "cancel")], before),
    ).toEqual([]);
  });

  it("drops a moved booking that was then cancelled", () => {
    const live = foldBookings(
      [
        row("1", booking),
        row("2", later, "reschedule", booking),
        row("3", later, "cancel"),
      ],
      before,
    );
    expect(live).toEqual([]);
  });

  it("survives a move of a move", () => {
    const latest: BookingProposal = {
      ...later,
      id: "b3",
      start: new Date("2026-01-05T15:00:00Z"),
      end: new Date("2026-01-05T16:00:00Z"),
      says: "Monday 5 January at 15:00",
      idempotencyKey: "calendar:haircut:2026-01-05T15:00:00.000Z",
    };
    const live = foldBookings(
      [
        row("1", booking),
        row("2", later, "reschedule", booking),
        row("3", latest, "reschedule", later),
      ],
      before,
    );
    expect(live.map((b) => b.says)).toEqual([latest.says]);
  });

  it("leaves out appointments that have already happened", () => {
    // They cannot be cancelled or moved, so offering them is a dead end.
    expect(foldBookings([row("1", booking)], new Date("2026-02-01T00:00:00Z"))).toEqual(
      [],
    );
  });

  it("ignores approvals that are not calendar ones", () => {
    const live = foldBookings(
      [
        { id: "1", details: { service: "Cut", preferredTime: "tomorrow" } },
        row("2", booking),
      ],
      before,
    );
    expect(live).toHaveLength(1);
  });

  it("keeps two separate bookings apart", () => {
    const live = foldBookings([row("1", booking), row("2", later)], before);
    expect(live).toHaveLength(2);
  });
});
