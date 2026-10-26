import { describe, expect, it } from "vitest";

import {
  calendarApprovalDetails,
  calendarProposalFromApproval,
  customerReplyFor,
  ownerNoteFor,
} from "../lib/calendar/approval";
import type { ConfirmOutcome } from "../lib/calendar/confirm";
import type { BookingProposal } from "../lib/calendar/tools";

const proposal: BookingProposal = {
  id: "p1",
  service: "Haircut",
  start: new Date("2026-01-05T09:00:00Z"),
  end: new Date("2026-01-05T10:00:00Z"),
  says: "Monday 5 January at 09:00",
  customerName: "Sam",
  idempotencyKey: "calendar:haircut:2026-01-05T09:00:00.000Z",
};

describe("carrying a proposal to the owner's decision", () => {
  it("survives the round trip through the approval row", () => {
    const details = calendarApprovalDetails(proposal);
    const back = calendarProposalFromApproval("approval-1", details);

    expect(back).not.toBeNull();
    expect(back!.start.toISOString()).toBe(proposal.start.toISOString());
    expect(back!.end.toISOString()).toBe(proposal.end.toISOString());
    expect(back!.service).toBe("Haircut");
    expect(back!.customerName).toBe("Sam");
  });

  it("keeps the key that stops a second write", () => {
    // Approving twice has to resolve to the same appointment, and the key is
    // the only thing that carries that across the two requests.
    const back = calendarProposalFromApproval(
      "approval-1",
      calendarApprovalDetails(proposal),
    );
    expect(back!.idempotencyKey).toBe(proposal.idempotencyKey);
  });

  it("survives the JSON round trip the database actually does", () => {
    const stored = JSON.parse(
      JSON.stringify(calendarApprovalDetails(proposal)),
    );
    expect(calendarProposalFromApproval("approval-1", stored)).not.toBeNull();
  });

  it("leaves a booking approval without a calendar alone", () => {
    // What request_booking writes for a workspace with no calendar. It must
    // keep behaving exactly as before: approved, and entered by the owner.
    const details = {
      service: "Haircut",
      preferredTime: "tomorrow afternoon",
      customerName: "Sam",
    };
    expect(calendarProposalFromApproval("approval-1", details)).toBeNull();
  });

  it.each([null, undefined, {}, { calendar: true }, "nonsense"])(
    "refuses to invent a booking from %s",
    (details) => {
      expect(calendarProposalFromApproval("approval-1", details)).toBeNull();
    },
  );

  it("refuses details carrying an unreadable time", () => {
    const details = {
      ...calendarApprovalDetails(proposal),
      startsAt: "not-a-date",
    };
    expect(calendarProposalFromApproval("approval-1", details)).toBeNull();
  });
});

describe("what the customer is told", () => {
  const outcomes: Record<string, ConfirmOutcome> = {
    booked: {
      status: "booked",
      event: {
        externalId: "evt_1",
        start: proposal.start,
        end: proposal.end,
      },
    },
    owner_books: { status: "owner_books", reason: "no write API." },
    no_longer_free: { status: "no_longer_free" },
    failed: { status: "failed", reason: "the calendar could not be reached." },
  };

  it("says it is confirmed only when the calendar confirmed it", () => {
    expect(customerReplyFor(outcomes.booked, proposal)).toMatch(/confirmed/i);
    expect(customerReplyFor(outcomes.booked, proposal)).toContain(
      proposal.says,
    );
  });

  it.each(["no_longer_free", "failed"])(
    "never implies a booking exists after %s",
    (key) => {
      const reply = customerReplyFor(outcomes[key], proposal);
      expect(reply).toMatch(/isn’t booked|not booked/i);
      // The failure modes must not reuse the confirmation wording.
      expect(reply).not.toMatch(/is confirmed/i);
    },
  );

  it("promises only a confirmation when the owner books it themselves", () => {
    const reply = customerReplyFor(outcomes.owner_books, proposal);
    expect(reply).toMatch(/confirmation shortly/i);
    expect(reply).not.toMatch(/is confirmed for/i);
  });

  it("fits the reply length the database accepts", () => {
    // hc_decide_approval rejects a reply over 600 characters, which would
    // turn a real booking into an error after the event was written.
    for (const outcome of Object.values(outcomes))
      expect(customerReplyFor(outcome, proposal).length).toBeLessThanOrEqual(
        600,
      );
  });

  it("tells the owner when approving did not book anything", () => {
    expect(ownerNoteFor(outcomes.booked)).toBeUndefined();
    expect(ownerNoteFor(outcomes.no_longer_free)).toMatch(/nothing was booked/i);
    expect(ownerNoteFor(outcomes.failed)).toMatch(/not booked/i);
  });
});
