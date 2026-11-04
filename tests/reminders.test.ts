import { describe, expect, it } from "vitest";

import {
  digestMessage,
  dueForReminder,
  reminderMessage,
  skipReason,
  REMINDER_FLOOR_HOURS,
  REMINDER_LEAD_HOURS,
  type Appointment,
} from "../lib/reminders";

/**
 * Who gets reminded and who does not.
 *
 * A reminder is a message to a real customer, so the rules that decide to
 * send one are worth pinning: sending twice is worse than sending late,
 * and sending to nobody is better than claiming to have sent.
 */

const now = new Date("2026-11-04T09:00:00Z");
const hoursFromNow = (hours: number) =>
  new Date(now.getTime() + hours * 3_600_000);

function appointment(over: Partial<Appointment> = {}): Appointment {
  return {
    id: "a1",
    service: "Studio visit",
    startsAt: hoursFromNow(20),
    says: "tomorrow at 5pm",
    customerName: "Sam",
    customerEmail: "sam@example.com",
    status: "booked",
    reminderSentAt: null,
    ...over,
  };
}

describe("deciding whether to send", () => {
  it("sends for a booked appointment inside the window", () => {
    expect(skipReason(appointment(), now)).toBeNull();
  });

  it("never sends twice", () => {
    expect(
      skipReason(appointment({ reminderSentAt: new Date() }), now),
    ).toBe("already_reminded");
  });

  it("does not remind about a cancelled appointment", () => {
    expect(skipReason(appointment({ status: "cancelled" }), now)).toBe(
      "cancelled",
    );
  });

  it("stays quiet when there is nowhere to send it", () => {
    // The ordinary case: a website visitor is never asked for an address.
    expect(skipReason(appointment({ customerEmail: null }), now)).toBe(
      "no_email",
    );
  });

  it("waits while the appointment is still far off", () => {
    expect(
      skipReason(
        appointment({ startsAt: hoursFromNow(REMINDER_LEAD_HOURS + 1) }),
        now,
      ),
    ).toBe("too_early");
  });

  it("sends right at the lead time rather than one run late", () => {
    expect(
      skipReason(
        appointment({ startsAt: hoursFromNow(REMINDER_LEAD_HOURS) }),
        now,
      ),
    ).toBeNull();
  });

  it("still catches one the cron missed by a few hours", () => {
    // A deploy or a cold start can skip a run. Dropping the reminder
    // silently is the failure this floor exists to avoid.
    expect(
      skipReason(appointment({ startsAt: hoursFromNow(4) }), now),
    ).toBeNull();
  });

  it("gives up rather than arriving as the customer walks in", () => {
    expect(
      skipReason(
        appointment({ startsAt: hoursFromNow(REMINDER_FLOOR_HOURS - 0.5) }),
        now,
      ),
    ).toBe("too_late");
  });

  it("does not remind about something already past", () => {
    expect(skipReason(appointment({ startsAt: hoursFromNow(-3) }), now)).toBe(
      "too_late",
    );
  });

  it("picks only the ones that qualify out of a mixed list", () => {
    const due = dueForReminder(
      [
        appointment({ id: "send" }),
        appointment({ id: "no-email", customerEmail: null }),
        appointment({ id: "done", reminderSentAt: new Date() }),
        appointment({ id: "far", startsAt: hoursFromNow(200) }),
        appointment({ id: "gone", status: "cancelled" }),
      ],
      now,
    );
    expect(due.map((item) => item.id)).toEqual(["send"]);
  });
});

describe("what the customer reads", () => {
  it("uses the time in the business's own words", () => {
    const message = reminderMessage(appointment(), "Northline Studio");
    expect(message.text).toContain("tomorrow at 5pm");
    expect(message.text).toContain("Studio visit");
    expect(message.text).toContain("Northline Studio");
    expect(message.subject).toContain("Northline Studio");
  });

  it("greets someone whose name we never learned without a gap", () => {
    const message = reminderMessage(
      appointment({ customerName: null }),
      "Northline Studio",
    );
    expect(message.text).toMatch(/^Hi,/);
    expect(message.text).not.toContain("null");
    expect(message.text).not.toContain("undefined");
  });

  it("falls back to the stored instant when there is no wording", () => {
    const message = reminderMessage(
      appointment({ says: null }),
      "Northline Studio",
    );
    expect(message.text).toContain("2026-11-05");
  });
});

describe("the owner's digest", () => {
  it("lists tomorrow in time order", () => {
    const digest = digestMessage(
      [
        appointment({ id: "late", says: "4pm", startsAt: hoursFromNow(26) }),
        appointment({ id: "early", says: "9am", startsAt: hoursFromNow(20) }),
      ],
      "Northline Studio",
    );
    expect(digest).not.toBeNull();
    expect(digest!.text.indexOf("9am")).toBeLessThan(digest!.text.indexOf("4pm"));
    expect(digest!.subject).toContain("2 appointments");
  });

  it("says one appointment, not 1 appointments", () => {
    const digest = digestMessage([appointment()], "Northline Studio");
    expect(digest!.subject).toContain("1 appointment tomorrow");
  });

  it("sends nothing when tomorrow is empty", () => {
    // An empty digest every morning is how an owner learns to filter us.
    expect(digestMessage([], "Northline Studio")).toBeNull();
    expect(
      digestMessage([appointment({ status: "cancelled" })], "Northline Studio"),
    ).toBeNull();
  });

  it("names a customer we do not know without printing a null", () => {
    const digest = digestMessage(
      [appointment({ customerName: null })],
      "Northline Studio",
    );
    expect(digest!.text).toContain("someone");
    expect(digest!.text).not.toContain("null");
  });
});
