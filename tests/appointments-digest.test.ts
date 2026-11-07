import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import { afterEach, describe, expect, it } from "vitest";

import { sendOwnerDigests } from "../lib/server/appointments";

/**
 * Marking the owner's digest as sent.
 *
 * Found in production: the digest arrived twice within a minute. The mark
 * was an update, and most workspaces have no notification settings row
 * until the owner opens the alerts panel, so it matched nothing, reported
 * no error, and the once-a-day guard never persisted. Inside the evening
 * window the cron runs four times, so the owner got four copies.
 */

type Call = { table: string; op: string; payload?: unknown };

const TENANT = "11111111-1111-1111-1111-111111111111";

function fakeAdmin(options: { settingsRow?: Record<string, unknown> | null } = {}) {
  const calls: Call[] = [];
  const appointmentRows = [
    {
      id: "a1",
      tenant_id: TENANT,
      service: "Haircut",
      // The digest runs on the evening of the 6th, so this is tomorrow.
      starts_at: "2026-11-07T15:00:00Z",
      says: "tomorrow at 3pm",
      customer_name: "Sam",
      customer_email: "sam@example.com",
      status: "booked" as const,
      reminder_sent_at: null,
    },
  ];

  const single = (table: string) => {
    if (table === "hc_notification_settings") return options.settingsRow ?? null;
    if (table === "hc_tenants") return { name: "Northline Studio" };
    if (table === "hc_memberships") return { user_id: "u1" };
    return null; // no calendar connection, so the zone falls back to UTC
  };

  const make = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "lt", "lte", "order", "limit", "is"])
      q[m] = () => q;
    q.maybeSingle = async () => ({ data: single(table), error: null });
    // The appointment queries await the chain itself rather than ending in
    // maybeSingle, so the builder has to be thenable.
    q.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({
        data: table === "hc_appointments" ? appointmentRows : [],
        error: null,
      }).then(resolve, reject);
    q.upsert = async (payload: unknown) => {
      calls.push({ table, op: "upsert", payload });
      return { error: null };
    };
    q.update = (payload: unknown) => {
      calls.push({ table, op: "update", payload });
      // What the real client does when the row is absent: no rows, no error.
      return { eq: async () => ({ error: null }) };
    };
    return q;
  };

  const admin = {
    from: (table: string) => make(table),
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: "owner@salon.com" } } }),
      },
    },
  } as never;

  return { admin, calls };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("marking the owner's digest as sent", () => {
  // 19:00 UTC, inside the send window, with no calendar so the zone is UTC.
  const evening = new Date("2026-11-06T19:00:00Z");

  function stubProvider() {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
  }

  it("records the date even when the workspace has no settings row", async () => {
    // The production case: nobody has opened the alerts panel, so there is
    // nothing to update. This is the regression.
    stubProvider();
    const { admin, calls } = fakeAdmin({ settingsRow: null });

    const run = await sendOwnerDigests(admin, evening);
    expect(run.sent).toBe(1);

    const marks = calls.filter((c) => c.table === "hc_notification_settings");
    expect(marks).toHaveLength(1);
    expect(marks[0].op).toBe("upsert");
    expect(marks[0].payload).toMatchObject({
      tenant_id: TENANT,
      last_digest_on: "2026-11-06",
    });
  });

  it("never marks with a bare update, which silently matches no row", async () => {
    stubProvider();
    const { admin, calls } = fakeAdmin({ settingsRow: null });
    await sendOwnerDigests(admin, evening);
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });

  it("does not mark when the provider refused the send", async () => {
    // Unmarked on purpose: the next run inside the window retries.
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("no", { status: 422 })),
    );
    const { admin, calls } = fakeAdmin({ settingsRow: null });

    const run = await sendOwnerDigests(admin, evening);
    expect(run.sent).toBe(0);
    expect(run.skipped.send_failed).toBe(1);
    expect(calls.filter((c) => c.table === "hc_notification_settings")).toHaveLength(0);
  });

  it("stays quiet once the date is already recorded", async () => {
    stubProvider();
    const { admin, calls } = fakeAdmin({
      settingsRow: { on_digest: true, last_digest_on: "2026-11-06" },
    });

    const run = await sendOwnerDigests(admin, evening);
    expect(run.sent).toBe(0);
    expect(run.skipped.already_sent).toBe(1);
    expect(calls).toHaveLength(0);
  });
});
