import { describe, expect, it } from "vitest";

import {
  describeSlot,
  localWallClock,
  mergeBusy,
  proposeSlots,
} from "../lib/calendar/slots";
import type { Interval, OpeningHours } from "../lib/calendar/types";

const LONDON = "Europe/London";
const NEW_YORK = "America/New_York";

// Monday to Friday, 09:00–17:00.
const weekdays: OpeningHours = {
  1: [{ opens: 9 * 60, closes: 17 * 60 }],
  2: [{ opens: 9 * 60, closes: 17 * 60 }],
  3: [{ opens: 9 * 60, closes: 17 * 60 }],
  4: [{ opens: 9 * 60, closes: 17 * 60 }],
  5: [{ opens: 9 * 60, closes: 17 * 60 }],
};

const at = (iso: string) => new Date(iso);
const window = (startIso: string, endIso: string): Interval => ({
  start: at(startIso),
  end: at(endIso),
});

describe("reading the business's own clock", () => {
  it("reports local time, not the server's", () => {
    // 14:30 UTC in January is 09:30 in New York.
    const parts = localWallClock(at("2026-01-05T14:30:00Z"), NEW_YORK);
    expect(parts.weekday).toBe(1); // Monday
    expect(parts.minuteOfDay).toBe(9 * 60 + 30);
  });

  it("handles midnight without rolling to 24:00", () => {
    const parts = localWallClock(at("2026-01-05T00:00:00Z"), LONDON);
    expect(parts.minuteOfDay).toBe(0);
  });

  it("follows British Summer Time", () => {
    // Same UTC instant, opposite sides of the DST change.
    expect(localWallClock(at("2026-01-15T12:00:00Z"), LONDON).minuteOfDay).toBe(
      12 * 60,
    );
    expect(localWallClock(at("2026-07-15T12:00:00Z"), LONDON).minuteOfDay).toBe(
      13 * 60,
    );
  });
});

describe("proposing times", () => {
  const base = {
    openingHours: weekdays,
    timeZone: LONDON,
    durationMinutes: 60,
    now: at("2026-01-05T06:00:00Z"), // Monday, before opening
  };

  it("offers the first free times inside opening hours", () => {
    const slots = proposeSlots({
      ...base,
      window: window("2026-01-05T00:00:00Z", "2026-01-06T00:00:00Z"),
      busy: [],
    });
    expect(slots).toHaveLength(3);
    // Opens at 09:00 local, which in January is 09:00 UTC.
    expect(slots[0].start.toISOString()).toBe("2026-01-05T09:00:00.000Z");
    expect(slots[1].start.toISOString()).toBe("2026-01-05T09:15:00.000Z");
  });

  it("never offers a time that is already taken", () => {
    const slots = proposeSlots({
      ...base,
      window: window("2026-01-05T00:00:00Z", "2026-01-06T00:00:00Z"),
      busy: [window("2026-01-05T09:00:00Z", "2026-01-05T12:00:00Z")],
    });
    expect(slots[0].start.toISOString()).toBe("2026-01-05T12:00:00.000Z");
  });

  it("lets one appointment start exactly when another ends", () => {
    const slots = proposeSlots({
      ...base,
      window: window("2026-01-05T00:00:00Z", "2026-01-06T00:00:00Z"),
      busy: [window("2026-01-05T09:00:00Z", "2026-01-05T10:00:00Z")],
      maxSlots: 1,
    });
    expect(slots[0].start.toISOString()).toBe("2026-01-05T10:00:00.000Z");
  });

  it("will not let an appointment run past closing", () => {
    const slots = proposeSlots({
      ...base,
      window: window("2026-01-05T15:30:00Z", "2026-01-05T23:59:00Z"),
      busy: [],
      durationMinutes: 90,
      maxSlots: 10,
    });
    // Closes at 17:00, so a 90-minute appointment cannot start after 15:30.
    for (const slot of slots)
      expect(slot.end.getTime()).toBeLessThanOrEqual(
        at("2026-01-05T17:00:00Z").getTime(),
      );
    expect(slots[0].start.toISOString()).toBe("2026-01-05T15:30:00.000Z");
  });

  it("skips days the business is closed", () => {
    const slots = proposeSlots({
      ...base,
      // Saturday and Sunday, running into Monday.
      window: window("2026-01-10T00:00:00Z", "2026-01-13T00:00:00Z"),
      busy: [],
      maxSlots: 1,
    });
    // The first offer is Monday morning, not the weekend.
    expect(slots[0].start.toISOString()).toBe("2026-01-12T09:00:00.000Z");
  });

  it("offers nothing at all when the window is only closed days", () => {
    const slots = proposeSlots({
      ...base,
      // Saturday and Sunday only.
      window: window("2026-01-10T00:00:00Z", "2026-01-12T00:00:00Z"),
      busy: [],
    });
    expect(slots).toEqual([]);
  });

  it("never offers a time in the past", () => {
    const slots = proposeSlots({
      ...base,
      now: at("2026-01-05T14:20:00Z"),
      window: window("2026-01-05T00:00:00Z", "2026-01-06T00:00:00Z"),
      busy: [],
      maxSlots: 1,
    });
    expect(slots[0].start.getTime()).toBeGreaterThanOrEqual(
      at("2026-01-05T14:20:00Z").getTime(),
    );
  });

  it("respects the notice the business wants", () => {
    const slots = proposeSlots({
      ...base,
      now: at("2026-01-05T10:00:00Z"),
      leadTimeMinutes: 120,
      window: window("2026-01-05T00:00:00Z", "2026-01-06T00:00:00Z"),
      busy: [],
      maxSlots: 1,
    });
    expect(slots[0].start.toISOString()).toBe("2026-01-05T12:00:00.000Z");
  });

  it("offers nothing rather than something wrong when the day is full", () => {
    const slots = proposeSlots({
      ...base,
      window: window("2026-01-05T00:00:00Z", "2026-01-06T00:00:00Z"),
      busy: [window("2026-01-05T00:00:00Z", "2026-01-06T00:00:00Z")],
    });
    expect(slots).toEqual([]);
  });

  it("returns nothing for a nonsensical duration", () => {
    const slots = proposeSlots({
      ...base,
      window: window("2026-01-05T00:00:00Z", "2026-01-06T00:00:00Z"),
      busy: [],
      durationMinutes: 0,
    });
    expect(slots).toEqual([]);
  });

  it("works for a business in another timezone", () => {
    const slots = proposeSlots({
      ...base,
      timeZone: NEW_YORK,
      window: window("2026-01-05T00:00:00Z", "2026-01-06T00:00:00Z"),
      busy: [],
      maxSlots: 1,
    });
    // 09:00 in New York in January is 14:00 UTC.
    expect(slots[0].start.toISOString()).toBe("2026-01-05T14:00:00.000Z");
  });
});

describe("daylight saving", () => {
  it("still opens at 09:00 local after the clocks change", () => {
    // Monday 30 March 2026, after BST began on 29 March.
    const slots = proposeSlots({
      openingHours: weekdays,
      timeZone: LONDON,
      durationMinutes: 60,
      now: at("2026-03-30T00:00:00Z"),
      window: window("2026-03-30T00:00:00Z", "2026-03-31T00:00:00Z"),
      busy: [],
      maxSlots: 1,
    });
    // 09:00 BST is 08:00 UTC — an hour earlier in UTC than in January.
    expect(slots[0].start.toISOString()).toBe("2026-03-30T08:00:00.000Z");
    expect(describeSlot(slots[0], LONDON)).toMatch(/09:00/);
  });

  it("never proposes an hour that does not exist", () => {
    // 01:00–02:00 local does not happen on 29 March 2026 in London.
    const overnight: OpeningHours = { 0: [{ opens: 0, closes: 23 * 60 + 59 }] };
    const slots = proposeSlots({
      openingHours: overnight,
      timeZone: LONDON,
      durationMinutes: 15,
      now: at("2026-03-29T00:00:00Z"),
      window: window("2026-03-29T00:00:00Z", "2026-03-29T03:00:00Z"),
      busy: [],
      stepMinutes: 15,
      maxSlots: 50,
    });
    const localHours = slots.map(
      (slot) => localWallClock(slot.start, LONDON).minuteOfDay,
    );
    // No proposal lands in the missing 01:00 hour.
    expect(localHours.filter((m) => m >= 60 && m < 120)).toEqual([]);
  });
});

describe("merging busy time", () => {
  it("collapses overlapping blocks", () => {
    const merged = mergeBusy([
      window("2026-01-05T09:00:00Z", "2026-01-05T10:00:00Z"),
      window("2026-01-05T09:30:00Z", "2026-01-05T11:00:00Z"),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].end.toISOString()).toBe("2026-01-05T11:00:00.000Z");
  });

  it("keeps genuinely separate blocks apart", () => {
    const merged = mergeBusy([
      window("2026-01-05T09:00:00Z", "2026-01-05T10:00:00Z"),
      window("2026-01-05T14:00:00Z", "2026-01-05T15:00:00Z"),
    ]);
    expect(merged).toHaveLength(2);
  });

  it("drops a block that ends before it starts", () => {
    expect(
      mergeBusy([window("2026-01-05T10:00:00Z", "2026-01-05T09:00:00Z")]),
    ).toEqual([]);
  });
});
