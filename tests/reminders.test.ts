import { describe, expect, it } from "vitest";

import {
  digestMessage,
  localDateIn,
  localHourIn,
  nextLocalDate,
  onLocalDay,
  shouldSendDigest,
  DIGEST_HOUR,
  DIGEST_LAST_HOUR,
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

describe("the business's own calendar day", () => {
  // Everything here asks the timezone rather than adding offsets, so the
  // daylight-saving cases are real instants rather than arithmetic.
  it("reads the local date, not the UTC one", () => {
    // 23:30 UTC on the 4th is already the 5th in Sydney and still the 4th
    // in London.
    const instant = new Date("2026-11-04T23:30:00Z");
    expect(localDateIn(instant, "Australia/Sydney")).toBe("2026-11-05");
    expect(localDateIn(instant, "Europe/London")).toBe("2026-11-04");
  });

  it("reads the local hour, not the UTC one", () => {
    const instant = new Date("2026-11-04T18:00:00Z");
    expect(localHourIn(instant, "UTC")).toBe(18);
    expect(localHourIn(instant, "America/New_York")).toBe(13);
  });

  it("rolls to the next date across a month end", () => {
    expect(nextLocalDate("2026-11-30")).toBe("2026-12-01");
    expect(nextLocalDate("2026-12-31")).toBe("2027-01-01");
  });

  it("rolls across a leap day", () => {
    expect(nextLocalDate("2028-02-28")).toBe("2028-02-29");
    expect(nextLocalDate("2028-02-29")).toBe("2028-03-01");
  });

  it("keeps the date stable across a daylight-saving change", () => {
    // London goes forward on 29 March 2026; 00:30 UTC is already that day.
    expect(localDateIn(new Date("2026-03-29T00:30:00Z"), "Europe/London")).toBe(
      "2026-03-29",
    );
    expect(nextLocalDate("2026-03-29")).toBe("2026-03-30");
  });

  it("picks only the appointments falling on that local day", () => {
    // The bug this replaced: a rolling now+24h to now+48h window sent at
    // 18:00 covered 6pm tomorrow to 6pm the day after — half of two days,
    // and not the day the email claims to describe.
    const tomorrow = "2026-11-05";
    const picked = onLocalDay(
      [
        appointment({ id: "late-today", startsAt: new Date("2026-11-04T22:00:00Z") }),
        appointment({ id: "early-tomorrow", startsAt: new Date("2026-11-05T08:00:00Z") }),
        appointment({ id: "late-tomorrow", startsAt: new Date("2026-11-05T20:00:00Z") }),
        appointment({ id: "day-after", startsAt: new Date("2026-11-06T09:00:00Z") }),
      ],
      tomorrow,
      "UTC",
    );
    expect(picked.map((item) => item.id)).toEqual([
      "early-tomorrow",
      "late-tomorrow",
    ]);
  });

  it("decides that day in the business's zone, not the server's", () => {
    // 21:00 UTC on the 5th is the 6th in Sydney, so it is not Sydney's
    // "tomorrow" when tomorrow is the 5th there.
    const evening = appointment({
      id: "sydney",
      startsAt: new Date("2026-11-05T21:00:00Z"),
    });
    expect(onLocalDay([evening], "2026-11-05", "UTC")).toHaveLength(1);
    expect(onLocalDay([evening], "2026-11-05", "Australia/Sydney")).toHaveLength(0);
    expect(onLocalDay([evening], "2026-11-06", "Australia/Sydney")).toHaveLength(1);
  });
});

describe("sending the owner's digest once a day", () => {
  const today = "2026-11-04";

  it("sends in the evening when none has gone out", () => {
    expect(shouldSendDigest(DIGEST_HOUR, null, today)).toBe(true);
  });

  it("stays quiet earlier in the day", () => {
    expect(shouldSendDigest(DIGEST_HOUR - 1, null, today)).toBe(false);
    expect(shouldSendDigest(9, null, today)).toBe(false);
  });

  it("catches a run the cron missed, up to a point", () => {
    // Same reasoning as the reminder floor: late beats dropped.
    expect(shouldSendDigest(DIGEST_HOUR + 1, null, today)).toBe(true);
    expect(shouldSendDigest(DIGEST_LAST_HOUR - 1, null, today)).toBe(true);
  });

  it("gives up once tomorrow stops meaning what it says", () => {
    expect(shouldSendDigest(DIGEST_LAST_HOUR, null, today)).toBe(false);
    expect(shouldSendDigest(23, null, today)).toBe(false);
  });

  it("never sends twice in one local day", () => {
    for (let hour = DIGEST_HOUR; hour < DIGEST_LAST_HOUR; hour += 1)
      expect(shouldSendDigest(hour, today, today), `hour ${hour}`).toBe(false);
  });

  it("sends again the next day", () => {
    expect(shouldSendDigest(DIGEST_HOUR, "2026-11-03", today)).toBe(true);
  });

  it("counts the day where the business is, not where the server is", () => {
    // The marker and the comparison are both local dates, so a workspace
    // whose evening falls on the next UTC day still gets exactly one.
    const sydneyEvening = new Date("2026-11-04T07:00:00Z");
    const localToday = localDateIn(sydneyEvening, "Australia/Sydney");
    expect(localToday).toBe("2026-11-04");
    expect(localHourIn(sydneyEvening, "Australia/Sydney")).toBe(18);
    expect(shouldSendDigest(18, localToday, localToday)).toBe(false);
  });
});
