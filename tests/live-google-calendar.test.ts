import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { calendarFromConnection } from "../lib/calendar/account";
import { proposeSlots } from "../lib/calendar/slots";
import {
  listConnectionsFor,
  type Connection,
} from "../lib/server/connections";
import type { GoogleCredentials } from "../lib/server/google";

/**
 * The one check that talks to real Google.
 *
 * Everything else in this suite stubs fetch, which proves the code is right
 * about an API we only read the docs for — exactly the gap that let us ship a
 * scope unable to call two of our own endpoints. This closes it, against a
 * calendar that is actually connected.
 *
 * Inert by default so CI never depends on a live account and a fresh clone
 * never reaches for someone's calendar. Read-only: it asks for busy
 * intervals, never event content, and writes nothing.
 *
 *   HC_LIVE_GOOGLE=1 npx vitest run tests/live-google-calendar.test.ts
 */
const live = process.env.HC_LIVE_GOOGLE === "1";

/** The dev server's own .env.local, which Vitest does not load. */
function loadEnv() {
  const path = fileURLToPath(new URL("../.env.local", import.meta.url));
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (line.trimStart().startsWith("#")) continue;
    const match = /^\s*([A-Za-z_][A-Za-z0-9_ ]*?)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (value) process.env[match[1].trim()] ??= value;
  }
}

describe.skipIf(!live)("a really connected Google Calendar", () => {
  let connection: Connection<GoogleCredentials>;

  beforeAll(async () => {
    loadEnv();
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!,
      { auth: { persistSession: false } },
    );

    // Which workspace owns the connected calendar; the rest goes through the
    // same loader and decryption the agent uses.
    const { data, error } = await admin
      .from("hc_channel_connections")
      .select("tenant_id")
      .eq("kind", "google_calendar")
      .eq("status", "connected")
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Could not read connections: ${error.message}`);
    if (!data) throw new Error("No connected Google Calendar to check.");

    const found = (
      await listConnectionsFor<GoogleCredentials>(
        admin,
        data.tenant_id,
        "google_calendar",
      )
    ).find((candidate) => candidate.status === "connected");
    if (!found) throw new Error("The calendar connection did not load.");
    connection = found;
  }, 30_000);

  it("loads as a calendar the crew can use", () => {
    const { account } = calendarFromConnection(connection);
    expect(account.calendarId).toBeTruthy();
    expect(account.timeZone).toBeTruthy();
  });

  it("reads busy intervals with the scopes we asked for", async () => {
    const { account, adapter } = calendarFromConnection(connection);
    const start = new Date();
    const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);

    // The call that 403'd before: freeBusy.query, reached through a token
    // refreshed from the stored grant. An empty list is a valid answer —
    // what matters is that Google answers instead of refusing.
    const busy = await adapter.readBusy(account, { start, end });

    expect(Array.isArray(busy)).toBe(true);
    for (const interval of busy)
      expect(interval.end.getTime()).toBeGreaterThan(interval.start.getTime());

    console.info(
      `[live] ${busy.length} busy interval(s) in the next 7 days on "${connection.displayName}"`,
    );
  }, 30_000);

  it("turns that into times the crew could actually offer", async () => {
    const { account, adapter } = calendarFromConnection(connection);
    const start = new Date();
    const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    const busy = await adapter.readBusy(account, { start, end });

    const slots = proposeSlots({
      window: { start, end },
      busy,
      openingHours: account.openingHours,
      timeZone: account.timeZone,
      durationMinutes: account.defaultDurationMinutes,
      leadTimeMinutes: account.leadTimeMinutes,
      now: start,
      maxSlots: 3,
    });

    // Nothing offered may overlap anything Google called busy.
    for (const slot of slots)
      for (const taken of busy)
        expect(
          slot.start.getTime() >= taken.end.getTime() ||
            slot.end.getTime() <= taken.start.getTime(),
        ).toBe(true);

    console.info(
      `[live] first offers: ${
        slots.map((slot) => slot.start.toISOString()).join(", ") || "none"
      }`,
    );
  }, 30_000);
});
