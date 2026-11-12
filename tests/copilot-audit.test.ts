import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The audit trail has to actually record something.
 *
 * `hc_audit_events` shipped with its RLS, its grants and its tests four days
 * before anything wrote to it: `storeAuditEvent` existed with zero callers,
 * so the table could not fill and the owner-facing claim behind it — that
 * they can see what happened in their workspace — was not true.
 *
 * These pin the wiring that fixed that, and the two properties that matter
 * more than the wiring itself:
 *
 *   - counts and codes only, never document text, customer words or model
 *     reasoning, enforced here by an exact-keys check rather than by hoping
 *     a future caller reads the schema comment;
 *   - an audit write can never delay, fail or undo the action it describes.
 */

const mocks = vi.hoisted(() => ({
  /** Callbacks `after` was handed, so a test can run them itself. */
  scheduled: [] as Array<() => Promise<void> | void>,
  /** `after` throws outside a request context; this simulates that. */
  afterThrows: false,
  configured: true,
}));

vi.mock("next/server", () => ({
  after: (fn: () => Promise<void> | void) => {
    if (mocks.afterThrows) throw new Error("`after` was called outside a request");
    mocks.scheduled.push(fn);
  },
}));

// Returned by auditAdminClient() when a secret key is present. The fake is
// installed per test, so this closes over a mutable holder.
const admin = { current: null as SupabaseClient | null };
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => admin.current,
}));
vi.mock("@/lib/supabase/config", () => ({
  isSupabaseConfigured: () => mocks.configured,
}));

import {
  type CopilotAuditEvent,
  recentAuditEvents,
  recordCopilotAudit,
  storeAuditEvent,
} from "../lib/server/copilot/audit";

/** Exactly the columns an audit row may carry. Anything else is content. */
const ALLOWED_COLUMNS = [
  "tenant_id",
  "actor_user_id",
  "actor_role",
  "event",
  "action",
  "resource",
  "safety",
  "outcome",
  "applied_count",
  "skipped_count",
  "reason",
].sort();

function writer(error: { message: string } | null = null) {
  const rows: Record<string, unknown>[] = [];
  const tables: string[] = [];
  const client = {
    from: (table: string) => {
      tables.push(table);
      return {
        insert: (row: Record<string, unknown>) => {
          rows.push(row);
          return Promise.resolve({ error });
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, rows, tables };
}

function reader(rows: Record<string, unknown>[], error: { message: string } | null = null) {
  const seen: { limit?: number } = {};
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: (n: number) => {
              seen.limit = n;
              return Promise.resolve({ data: rows, error });
            },
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
  return { client, seen };
}

const entry: CopilotAuditEvent = {
  event: "workflow.published",
  tenantId: "tenant-1",
  userId: "user-1",
  role: "owner",
  action: "publish_workflow",
  safety: "live_configuration",
  resource: "workflow",
  outcome: "applied",
  applied: 3,
  skipped: 1,
  at: "2026-11-11T09:00:00.000Z",
};

const action = {
  name: "publish_workflow",
  safety: "live_configuration",
  resource: "workflow",
  audit: { event: "workflow.published" },
} as Parameters<typeof recordCopilotAudit>[1];

// Typed through the function's own signature rather than restating
// WorkspaceRole here, so a change to the role union surfaces as a type error
// instead of this fixture drifting out of step with it.
const workspace = {
  tenantId: "tenant-1",
  userId: "user-1",
  role: "owner",
} as Parameters<typeof recordCopilotAudit>[0];

beforeEach(() => {
  mocks.scheduled.length = 0;
  mocks.afterThrows = false;
  mocks.configured = true;
  admin.current = null;
  process.env.SUPABASE_SECRET_KEY = "secret-for-tests";
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("storing an audit event", () => {
  it("records who did what to which resource, and how it ended", async () => {
    const sink = writer();
    expect(await storeAuditEvent(sink.client, entry)).toBe(true);

    expect(sink.tables).toEqual(["hc_audit_events"]);
    expect(sink.rows[0]).toMatchObject({
      tenant_id: "tenant-1",
      actor_user_id: "user-1",
      actor_role: "owner",
      event: "workflow.published",
      action: "publish_workflow",
      resource: "workflow",
      safety: "live_configuration",
      outcome: "applied",
      applied_count: 3,
      skipped_count: 1,
    });
  });

  it("writes counts and codes only, never content", async () => {
    // The check that matters. A future caller adding `document_text` or the
    // model's reasoning to the entry must fail here rather than quietly turn
    // an audit trail into a copy of what was written.
    const sink = writer();
    await storeAuditEvent(sink.client, {
      ...entry,
      reason: "provider rejected",
    });
    expect(Object.keys(sink.rows[0]).sort()).toEqual(ALLOWED_COLUMNS);
  });

  it("bounds reason, so a long provider message trims instead of losing the row", async () => {
    const sink = writer();
    await storeAuditEvent(sink.client, { ...entry, reason: "x".repeat(500) });
    expect((sink.rows[0].reason as string).length).toBe(200);
  });

  it("leaves the counts null when the action reported none", async () => {
    const sink = writer();
    const withoutCounts: CopilotAuditEvent = { ...entry };
    delete withoutCounts.applied;
    delete withoutCounts.skipped;
    await storeAuditEvent(sink.client, withoutCounts);
    expect(sink.rows[0]).toMatchObject({
      applied_count: null,
      skipped_count: null,
      reason: null,
    });
  });

  it("nulls the actor when the system acted, not a person", async () => {
    const sink = writer();
    await storeAuditEvent(sink.client, { ...entry, userId: "" });
    expect(sink.rows[0].actor_user_id).toBeNull();
  });

  it("reports failure instead of throwing, so the action is not undone", async () => {
    const sink = writer({ message: "permission denied" });
    await expect(storeAuditEvent(sink.client, entry)).resolves.toBe(false);
  });
});

describe("recording an action", () => {
  it("returns the entry it logged", () => {
    const recorded = recordCopilotAudit(workspace, action, "applied", { applied: 3 });
    expect(recorded).toMatchObject({
      event: "workflow.published",
      tenantId: "tenant-1",
      action: "publish_workflow",
      outcome: "applied",
      applied: 3,
    });
    expect(console.info).toHaveBeenCalled();
  });

  it("schedules the row, and the scheduled work stores it", async () => {
    const sink = writer();
    admin.current = sink.client;

    recordCopilotAudit(workspace, action, "applied", { applied: 3 });
    // Nothing is written during the action itself.
    expect(sink.rows).toHaveLength(0);
    expect(mocks.scheduled).toHaveLength(1);

    await mocks.scheduled[0]!();
    expect(sink.rows[0]).toMatchObject({
      tenant_id: "tenant-1",
      action: "publish_workflow",
      outcome: "applied",
    });
  });

  it("records a refusal, not only the outcomes that worked", async () => {
    // `after` runs even when the action throws or redirects, which is what
    // keeps refused and failed outcomes on the record. If only successes
    // were audited the trail would be worse than none.
    const sink = writer();
    admin.current = sink.client;

    recordCopilotAudit(workspace, action, "refused", { reason: "forbidden" });
    await mocks.scheduled[0]!();
    expect(sink.rows[0]).toMatchObject({ outcome: "refused", reason: "forbidden" });
  });

  it("still logs, and does not throw, outside a request context", () => {
    // A cron or a script has no response to be after. Those callers keep the
    // behaviour they had before the table existed.
    mocks.afterThrows = true;
    expect(() => recordCopilotAudit(workspace, action, "applied")).not.toThrow();
    expect(console.info).toHaveBeenCalled();
  });

  it("skips the write when the server has no secret key", async () => {
    delete process.env.SUPABASE_SECRET_KEY;
    const sink = writer();
    admin.current = sink.client;

    recordCopilotAudit(workspace, action, "applied");
    await mocks.scheduled[0]!();
    expect(sink.rows).toHaveLength(0);
  });

  it("survives an audit write that fails", async () => {
    const sink = writer({ message: "insert failed" });
    admin.current = sink.client;

    recordCopilotAudit(workspace, action, "applied");
    await expect(mocks.scheduled[0]!()).resolves.not.toThrow();
  });
});

describe("reading the workspace's history", () => {
  it("maps stored rows back, newest first", async () => {
    const source = reader([
      {
        event: "workflow.published",
        action: "publish_workflow",
        resource: "workflow",
        safety: "live_configuration",
        outcome: "applied",
        applied_count: 3,
        skipped_count: null,
        reason: null,
        actor_user_id: "user-1",
        actor_role: "owner",
        created_at: "2026-11-11T09:00:00.000Z",
      },
    ]);
    const events = await recentAuditEvents(source.client, "tenant-1");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: "workflow.published",
      outcome: "applied",
      applied: 3,
      at: "2026-11-11T09:00:00.000Z",
    });
    // Absent counts stay absent rather than becoming 0, which would read as
    // "applied nothing" instead of "did not report".
    expect(events[0]).not.toHaveProperty("skipped");
    expect(events[0]).not.toHaveProperty("reason");
  });

  it("clamps the page size so a caller cannot ask for everything", async () => {
    const wide = reader([]);
    await recentAuditEvents(wide.client, "tenant-1", 10_000);
    expect(wide.seen.limit).toBe(200);

    const narrow = reader([]);
    await recentAuditEvents(narrow.client, "tenant-1", 0);
    expect(narrow.seen.limit).toBe(1);
  });

  it("returns nothing, rather than throwing, when the read fails", async () => {
    const broken = reader([], { message: "rls denied" });
    await expect(recentAuditEvents(broken.client, "tenant-1")).resolves.toEqual([]);
  });
});
