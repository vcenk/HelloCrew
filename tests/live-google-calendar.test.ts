import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { calendarFromConnection } from "../lib/calendar/account";
import { cancelBooking } from "../lib/calendar/cancel";
import { rescheduleBooking } from "../lib/calendar/reschedule";
import { confirmBooking } from "../lib/calendar/confirm";
import type { BookingProposal } from "../lib/calendar/tools";
import { describeSlot, proposeSlots } from "../lib/calendar/slots";
import {
  listConnectionsFor,
  type Connection,
} from "../lib/server/connections";
import {
  googleAccessToken,
  type GoogleCredentials,
} from "../lib/server/google";

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

/** The connected calendar, loaded the way the agent's own turn loads it. */
async function loadConnection(): Promise<Connection<GoogleCredentials>> {
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
  return found;
}

describe.skipIf(!live)("a really connected Google Calendar", () => {
  let connection: Connection<GoogleCredentials>;

  beforeAll(async () => {
    connection = await loadConnection();
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

/**
 * The write path, against a real calendar.
 *
 * Behind its own flag, because unlike the checks above this one creates
 * something on someone's calendar. It books a clearly-labelled slot, proves
 * that approving twice writes once, and deletes what it made in afterAll —
 * including when an assertion fails partway.
 *
 *   HC_LIVE_GOOGLE_WRITE=1 npx vitest run tests/live-google-calendar.test.ts
 */
const liveWrite = process.env.HC_LIVE_GOOGLE_WRITE === "1";

describe.skipIf(!liveWrite)("writing an approved booking", () => {
  let connection: Connection<GoogleCredentials>;
  // A list, not one id: a test that fails partway still has to hand its
  // event to the cleanup, and a single variable loses it the moment the
  // next test writes one.
  const createdIds = new Set<string>();

  beforeAll(async () => {
    connection = await loadConnection();
  }, 30_000);

  // Runs whatever happened above, so a failed assertion never leaves an
  // appointment behind on a real calendar.
  afterAll(async () => {
    if (createdIds.size === 0) return;
    const { account } = calendarFromConnection(connection);
    const token = await googleAccessToken(connection.credentials ?? null);
    for (const id of createdIds) {
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
          account.calendarId,
        )}/events/${encodeURIComponent(id)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
      );
      // 404 or 410 means it was already gone, which is just as clean.
      if (!response.ok && response.status !== 410 && response.status !== 404)
        throw new Error(
          `Could not remove the test event ${id}: ${response.status}. Delete it by hand.`,
        );
      console.info(`[live] removed the test event ${id}`);
    }
    createdIds.clear();
  }, 60_000);

  it("cancels what it booked, and says so only once Google agrees", async () => {
    const { account, adapter } = calendarFromConnection(connection);
    const start = new Date();
    const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    const busy = await adapter.readBusy(account, { start, end });
    const [slot] = proposeSlots({
      window: { start, end },
      busy,
      openingHours: account.openingHours,
      timeZone: account.timeZone,
      durationMinutes: account.defaultDurationMinutes,
      leadTimeMinutes: account.leadTimeMinutes,
      now: start,
      maxSlots: 1,
    });
    expect(slot, "no free slot in the next 7 days to test with").toBeTruthy();

    const key = `live-cancel-check-${Date.now()}`;
    const proposal: BookingProposal = {
      id: key,
      start: slot.start,
      end: slot.end,
      service: "HelloCrew cancel check (safe to delete)",
      says: describeSlot(slot, account.timeZone),
      idempotencyKey: key,
    };

    const booked = await confirmBooking({ account, adapter, proposal });
    expect(booked.status).toBe("booked");
    if (booked.status === "booked") createdIds.add(booked.event.externalId);

    const cancelled = await cancelBooking({
      account,
      adapter,
      idempotencyKey: key,
    });
    expect(cancelled.status).toBe("cancelled");
    // Gone from Google already; cleanup tolerates a 404 if it tries again.

    // Really gone: a fresh lookup must not find it.
    expect(await adapter.findEvent!(account, key)).toBeNull();

    // And asking again is settled, not an error.
    const again = await cancelBooking({ account, adapter, idempotencyKey: key });
    expect(again.status).toBe("already_gone");
    console.info(`[live] booked and cancelled ${proposal.says}`);
  }, 60_000);

  it("moves an appointment, leaving only the new time behind", async () => {
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
      maxSlots: 40,
    });
    // Offered slots overlap — they step every 15 minutes — so the second one
    // has to start after the first ends, or booking it is a double booking.
    const first = slots[0];
    const second = slots.find(
      (slot) => slot.start.getTime() >= first?.end.getTime(),
    );
    expect(
      second,
      "need two non-overlapping free slots to move between",
    ).toBeTruthy();

    const stamp = Date.now();
    const service = "HelloCrew move check (safe to delete)";
    const from: BookingProposal = {
      id: `from-${stamp}`,
      start: first.start,
      end: first.end,
      service,
      says: describeSlot(first, account.timeZone),
      idempotencyKey: `live-move-from-${stamp}`,
    };
    const to: BookingProposal = {
      id: `to-${stamp}`,
      start: second!.start,
      end: second!.end,
      service,
      says: describeSlot(second!, account.timeZone),
      idempotencyKey: `live-move-to-${stamp}`,
    };

    const booked = await confirmBooking({ account, adapter, proposal: from });
    expect(booked.status).toBe("booked");
    if (booked.status === "booked") createdIds.add(booked.event.externalId);

    const moved = await rescheduleBooking({ account, adapter, from, to });
    expect(moved.status).toBe("moved");
    if (moved.status === "moved") createdIds.add(moved.event.externalId);

    // Exactly one appointment survives, and it is the new one.
    expect(await adapter.findEvent!(account, from.idempotencyKey)).toBeNull();
    const now = await adapter.findEvent!(account, to.idempotencyKey);
    expect(now).not.toBeNull();
    expect(now!.start.toISOString()).toBe(to.start.toISOString());
    console.info(`[live] moved ${from.says} -> ${to.says}`);
  }, 90_000);

  it("books an approved slot and reports only what Google confirmed", async () => {
    const { account, adapter } = calendarFromConnection(connection);
    const start = new Date();
    const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    const busy = await adapter.readBusy(account, { start, end });

    const [slot] = proposeSlots({
      window: { start, end },
      busy,
      openingHours: account.openingHours,
      timeZone: account.timeZone,
      durationMinutes: account.defaultDurationMinutes,
      leadTimeMinutes: account.leadTimeMinutes,
      now: start,
      maxSlots: 1,
    });
    expect(slot, "no free slot in the next 7 days to test with").toBeTruthy();

    const key = `live-write-check-${Date.now()}`;
    const proposal: BookingProposal = {
      id: key,
      start: slot.start,
      end: slot.end,
      service: "HelloCrew write check (safe to delete)",
      says: describeSlot(slot, account.timeZone),
      idempotencyKey: key,
    };

    const outcome = await confirmBooking({ account, adapter, proposal });
    if (outcome.status === "booked") createdIds.add(outcome.event.externalId);

    expect(
      outcome.status,
      outcome.status === "failed" ? outcome.reason : outcome.status,
    ).toBe("booked");
    if (outcome.status !== "booked") return;

    expect(outcome.event.externalId).toBeTruthy();
    expect(outcome.event.start.toISOString()).toBe(slot.start.toISOString());
    console.info(
      `[live] booked ${outcome.event.start.toISOString()} -> ${outcome.event.externalId}`,
    );

    // Approving the same proposal twice must find the first event rather than
    // write a second one onto the same slot.
    const replay = await confirmBooking({ account, adapter, proposal });
    expect(replay.status).toBe("booked");
    if (replay.status === "booked")
      expect(replay.event.externalId).toBe(outcome.event.externalId);
  }, 60_000);
});
