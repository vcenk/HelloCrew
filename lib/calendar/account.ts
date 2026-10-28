import "server-only";

import { z } from "zod";

import type { Connection } from "@/lib/server/connections";
import { googleAccessToken, type GoogleCredentials } from "@/lib/server/google";
import { googleCalendarAdapter } from "./google-calendar";
import type { CalendarAccount, CalendarAdapter, OpeningHours } from "./types";

/**
 * The working hours a connection carries, validated on the way out of the
 * database. A malformed settings object must not become a silently empty
 * week — that would read as "never free" and quietly stop the crew booking.
 */
const openingBlock = z.object({
  opens: z.number().int().min(0).max(1440),
  closes: z.number().int().min(0).max(1440),
});

const settingsSchema = z.object({
  timeZone: z.string().min(1).max(64),
  openingHours: z.record(z.string(), z.array(openingBlock)),
  defaultDurationMinutes: z.number().int().min(5).max(480).default(60),
  leadTimeMinutes: z.number().int().min(0).max(10_080).default(60),
  /**
   * When the owner last confirmed these settings themselves.
   *
   * Absent means nobody has: the timezone is whatever the connected calendar
   * happened to be set to, which is a reasonable guess and an easy one to be
   * wrong about. A business whose Google Calendar still says the city they
   * set it up in would otherwise offer customers the wrong hours with
   * nothing on screen ever saying so.
   */
  reviewedAt: z.string().datetime().optional(),
});

export type CalendarSettings = z.infer<typeof settingsSchema>;

/** Sensible starting point for a new connection: weekdays, 09:00–17:00. */
export const DEFAULT_CALENDAR_SETTINGS: CalendarSettings = {
  timeZone: "Europe/London",
  openingHours: {
    "1": [{ opens: 540, closes: 1020 }],
    "2": [{ opens: 540, closes: 1020 }],
    "3": [{ opens: 540, closes: 1020 }],
    "4": [{ opens: 540, closes: 1020 }],
    "5": [{ opens: 540, closes: 1020 }],
  },
  defaultDurationMinutes: 60,
  leadTimeMinutes: 60,
};

export class CalendarSettingsError extends Error {}

/** Checks a timezone is one this runtime actually knows. */
export function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function parseCalendarSettings(raw: unknown): CalendarSettings {
  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success)
    throw new CalendarSettingsError(
      "This calendar's working hours need setting up again.",
    );
  if (!isKnownTimeZone(parsed.data.timeZone))
    throw new CalendarSettingsError(
      `"${parsed.data.timeZone}" is not a timezone this server knows.`,
    );
  // A block that closes before it opens would silently offer nothing.
  for (const blocks of Object.values(parsed.data.openingHours))
    for (const block of blocks)
      if (block.closes <= block.opens)
        throw new CalendarSettingsError(
          "A closing time is earlier than its opening time.",
        );
  return parsed.data;
}

function toOpeningHours(settings: CalendarSettings): OpeningHours {
  const hours: OpeningHours = {};
  for (const [day, blocks] of Object.entries(settings.openingHours)) {
    const weekday = Number(day);
    if (weekday >= 0 && weekday <= 6)
      hours[weekday as keyof OpeningHours] = blocks;
  }
  return hours;
}

/**
 * Turns a stored connection into the account and adapter the tools use.
 *
 * Only google_calendar is wired today. Square, Vagaro and an iCal reader slot
 * in here without the tools or the approval flow changing.
 */
export function calendarFromConnection(
  connection: Connection<GoogleCredentials>,
): { account: CalendarAccount; adapter: CalendarAdapter } {
  if (connection.kind !== "google_calendar")
    throw new CalendarSettingsError(
      `"${connection.kind}" is not a calendar connection.`,
    );

  const settings = parseCalendarSettings(connection.settings);

  return {
    account: {
      provider: "google_calendar",
      calendarId: connection.externalId,
      timeZone: settings.timeZone,
      openingHours: toOpeningHours(settings),
      defaultDurationMinutes: settings.defaultDurationMinutes,
      leadTimeMinutes: settings.leadTimeMinutes,
    },
    adapter: googleCalendarAdapter({
      // Refreshed per call: a token can expire mid-conversation.
      accessToken: () => googleAccessToken(connection.credentials ?? null),
    }),
  };
}
