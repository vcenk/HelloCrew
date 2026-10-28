import { describe, expect, it } from "vitest";

import {
  DEFAULT_CALENDAR_SETTINGS,
  parseCalendarSettings,
} from "../lib/calendar/account";
import { proposeSlots } from "../lib/calendar/slots";
import type { OpeningHours } from "../lib/calendar/types";

/** Mirrors the editor's conversion between "09:00" and minutes. */
const toTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const toMinutes = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
};

describe("the editor's time conversion", () => {
  it("round-trips every quarter hour of the day", () => {
    for (let minutes = 0; minutes < 1440; minutes += 15)
      expect(toMinutes(toTime(minutes)), toTime(minutes)).toBe(minutes);
  });

  it("pads single digits the way an input expects", () => {
    expect(toTime(540)).toBe("09:00");
    expect(toTime(5)).toBe("00:05");
    expect(toTime(1020)).toBe("17:00");
  });
});

describe("what the editor is allowed to save", () => {
  it("accepts a closed day as an empty list", () => {
    const settings = {
      ...DEFAULT_CALENDAR_SETTINGS,
      openingHours: { ...DEFAULT_CALENDAR_SETTINGS.openingHours, "3": [] },
    };
    expect(() => parseCalendarSettings(settings)).not.toThrow();
  });

  it("a closed day really offers nothing", () => {
    const closedWednesday: OpeningHours = {
      1: [{ opens: 540, closes: 1020 }],
      3: [],
    };
    const slots = proposeSlots({
      // Wednesday 7 January 2026.
      window: {
        start: new Date("2026-01-07T00:00:00Z"),
        end: new Date("2026-01-08T00:00:00Z"),
      },
      busy: [],
      openingHours: closedWednesday,
      timeZone: "Europe/London",
      durationMinutes: 60,
      now: new Date("2026-01-07T00:00:00Z"),
    });
    expect(slots).toEqual([]);
  });

  it("refuses hours the crew would then refuse to read", () => {
    // The editor and the agent run the same validation, so the UI cannot save
    // something that quietly stops bookings.
    expect(() =>
      parseCalendarSettings({
        ...DEFAULT_CALENDAR_SETTINGS,
        openingHours: { "1": [{ opens: 1020, closes: 540 }] },
      }),
    ).toThrow(/earlier than/i);
  });

  it("saved hours are the ones actually offered", () => {
    const settings = parseCalendarSettings({
      ...DEFAULT_CALENDAR_SETTINGS,
      timeZone: "Europe/Istanbul",
      openingHours: { "1": [{ opens: toMinutes("11:30"), closes: toMinutes("16:00") }] },
    });
    const slots = proposeSlots({
      window: {
        start: new Date("2026-01-05T00:00:00Z"),
        end: new Date("2026-01-06T00:00:00Z"),
      },
      busy: [],
      openingHours: { 1: settings.openingHours["1"] },
      timeZone: settings.timeZone,
      durationMinutes: 60,
      now: new Date("2026-01-05T00:00:00Z"),
      maxSlots: 1,
    });
    // 11:30 in Istanbul (UTC+3) is 08:30 UTC.
    expect(slots[0].start.toISOString()).toBe("2026-01-05T08:30:00.000Z");
  });

  it("a shortest-notice setting holds the first offer back", () => {
    const slots = proposeSlots({
      window: {
        start: new Date("2026-01-05T00:00:00Z"),
        end: new Date("2026-01-06T00:00:00Z"),
      },
      busy: [],
      openingHours: { 1: [{ opens: 540, closes: 1020 }] },
      timeZone: "Europe/London",
      durationMinutes: 60,
      now: new Date("2026-01-05T09:00:00Z"),
      leadTimeMinutes: 240,
      maxSlots: 1,
    });
    expect(slots[0].start.toISOString()).toBe("2026-01-05T13:00:00.000Z");
  });
});

/**
 * The timezone is taken from whatever the connected Google Calendar happens
 * to be set to. That is a fair guess and an easy one to be wrong about — a
 * calendar still set to the city it was created in would have the crew offer
 * customers the wrong hours, with nothing on screen ever saying where the
 * zone came from. So settings carry whether anyone has actually confirmed
 * them.
 */
describe("whether anyone has checked the timezone", () => {
  it("a freshly connected calendar counts as unconfirmed", () => {
    const settings = parseCalendarSettings(DEFAULT_CALENDAR_SETTINGS);
    expect(settings.reviewedAt).toBeUndefined();
  });

  it("keeps the stamp once the owner has saved", () => {
    const at = "2026-10-28T09:00:00.000Z";
    const settings = parseCalendarSettings({
      ...DEFAULT_CALENDAR_SETTINGS,
      reviewedAt: at,
    });
    expect(settings.reviewedAt).toBe(at);
  });

  it("refuses a stamp that is not a time", () => {
    expect(() =>
      parseCalendarSettings({
        ...DEFAULT_CALENDAR_SETTINGS,
        reviewedAt: "yesterday",
      }),
    ).toThrow();
  });

  it("does not change which times are offered", () => {
    // The stamp is for the owner, not the crew: it must never affect what a
    // customer is told is free.
    const base = {
      window: {
        start: new Date("2026-01-05T00:00:00Z"),
        end: new Date("2026-01-06T00:00:00Z"),
      },
      busy: [],
      openingHours: { 1: [{ opens: 540, closes: 1020 }] } as OpeningHours,
      timeZone: "Europe/London",
      durationMinutes: 60,
      now: new Date("2026-01-05T00:00:00Z"),
    };
    const before = proposeSlots(base);

    const reviewed = parseCalendarSettings({
      ...DEFAULT_CALENDAR_SETTINGS,
      reviewedAt: "2026-10-28T09:00:00.000Z",
    });
    const after = proposeSlots({
      ...base,
      openingHours: { 1: reviewed.openingHours["1"] },
      timeZone: reviewed.timeZone,
    });

    expect(after.map((slot) => slot.start.toISOString())).toEqual(
      before.map((slot) => slot.start.toISOString()),
    );
  });
});
