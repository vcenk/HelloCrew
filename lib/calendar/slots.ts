import type {
  Interval,
  MinuteOfDay,
  OpeningHours,
  Weekday,
} from "./types";

const MINUTE = 60_000;

/**
 * Where an instant falls on the business's own clock.
 *
 * Everything here steps through absolute instants and asks the timezone what
 * the local time is, rather than building local times and converting. That is
 * what makes daylight saving a non-event: the hour that does not exist in
 * spring is simply never produced, and the hour that happens twice in autumn
 * produces two real instants.
 */
export function localWallClock(
  instant: Date,
  timeZone: string,
): { weekday: Weekday; minuteOfDay: MinuteOfDay } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);

  const read = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const weekday = (
    { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as const
  )[read("weekday") as "Sun"];

  return {
    weekday: (weekday ?? 0) as Weekday,
    minuteOfDay: Number(read("hour")) * 60 + Number(read("minute")),
  };
}

function overlaps(a: Interval, b: Interval): boolean {
  // Touching end-to-start is not an overlap: 10:00–11:00 and 11:00–12:00 fit.
  return a.start < b.end && b.start < a.end;
}

/** True when the whole appointment sits inside one opening block. */
function withinOpeningHours(
  start: Date,
  durationMinutes: number,
  timeZone: string,
  openingHours: OpeningHours,
): boolean {
  const at = localWallClock(start, timeZone);
  const blocks = openingHours[at.weekday] ?? [];
  const finishes = at.minuteOfDay + durationMinutes;

  return blocks.some(
    (block) => at.minuteOfDay >= block.opens && finishes <= block.closes,
  );
}

/**
 * Times the business could actually take, newest constraint first:
 * inside opening hours, not already busy, not in the past, and not sooner
 * than the business is willing to be given notice.
 *
 * Returns instants. Formatting for a customer is the caller's job, because
 * only the caller knows which timezone to say it in.
 */
export function proposeSlots(options: {
  window: Interval;
  busy: Interval[];
  openingHours: OpeningHours;
  timeZone: string;
  durationMinutes: number;
  now: Date;
  leadTimeMinutes?: number;
  /** Granularity of the times offered. 15 means :00, :15, :30, :45. */
  stepMinutes?: number;
  maxSlots?: number;
}): Interval[] {
  const {
    window,
    busy,
    openingHours,
    timeZone,
    durationMinutes,
    now,
    leadTimeMinutes = 0,
    stepMinutes = 15,
    maxSlots = 3,
  } = options;

  if (durationMinutes <= 0 || stepMinutes <= 0 || maxSlots <= 0) return [];

  const earliest = new Date(now.getTime() + leadTimeMinutes * MINUTE);
  const found: Interval[] = [];

  // Start on a clean step boundary so the times offered are tidy.
  const firstStep =
    Math.ceil(
      Math.max(window.start.getTime(), earliest.getTime()) /
        (stepMinutes * MINUTE),
    ) *
    (stepMinutes * MINUTE);

  for (
    let time = firstStep;
    time + durationMinutes * MINUTE <= window.end.getTime();
    time += stepMinutes * MINUTE
  ) {
    const slot: Interval = {
      start: new Date(time),
      end: new Date(time + durationMinutes * MINUTE),
    };

    if (!withinOpeningHours(slot.start, durationMinutes, timeZone, openingHours))
      continue;
    if (busy.some((taken) => overlaps(slot, taken))) continue;

    found.push(slot);
    if (found.length >= maxSlots) break;
  }

  return found;
}

/** Merges overlapping busy intervals, so a double-booked hour counts once. */
export function mergeBusy(busy: Interval[]): Interval[] {
  const sorted = [...busy]
    .filter((interval) => interval.start < interval.end)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) {
      if (interval.end > last.end) last.end = interval.end;
      continue;
    }
    merged.push({ start: interval.start, end: interval.end });
  }
  return merged;
}

/** How a proposed time should be said to a customer, in the business's zone. */
export function describeSlot(slot: Interval, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(slot.start);
}
