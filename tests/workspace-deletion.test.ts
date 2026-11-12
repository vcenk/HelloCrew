import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import { describe, expect, it } from "vitest";

import {
  DELETION_STEPS,
  STEP_TABLES,
  advanceDeletion,
  deleteTenantStorage,
  pendingDeletions,
  type DeletionStep,
} from "../lib/server/workspace-deletion";

/**
 * A pilot business must be able to leave, and leaving must be complete.
 *
 * The failure worth guarding is not a crash. It is a table quietly missing
 * from the list, so deletion reports success while a workspace's data stays
 * behind. The first test reads the migrations and fails when a tenant table
 * exists that no step clears, which is the only version of this check that
 * keeps working as the schema grows.
 */

const DIR = join(process.cwd(), "supabase", "migrations");
const all = readdirSync(DIR)
  .filter((name) => name.endsWith(".sql"))
  .map((name) => readFileSync(join(DIR, name), "utf8"))
  .join("\n");

/** Every hc_ table the migrations define. */
const declared = new Set(
  [...all.matchAll(/create table (?:if not exists )?public\.(hc_\w+)\s*\(/g)].map(
    (m) => m[1],
  ),
);

/**
 * Tables a deletion run must not clear, each for a stated reason. Anything
 * not listed here and not covered by a step is a bug.
 */
const NOT_DELETED = new Map<string, string>([
  [
    "hc_workspace_deletions",
    "the record that deletion happened; removing it would erase the evidence",
  ],
  [
    "hc_webhook_events",
    "holds no tenant data, only provider delivery ids",
  ],
  [
    "hc_rate_limits",
    "holds no tenant data, only abuse counters",
  ],
]);

const covered = new Set(Object.values(STEP_TABLES).flat());

describe("the deletion step list", () => {
  it("clears every tenant table the migrations define", () => {
    const missed = [...declared].filter(
      (table) => !covered.has(table) && !NOT_DELETED.has(table),
    );
    expect(
      missed,
      `these tables survive deletion with no reason given: ${missed.join(", ")}`,
    ).toEqual([]);
  });

  it("does not name a table that no longer exists", () => {
    const ghosts = [...covered].filter((table) => !declared.has(table));
    expect(ghosts, `steps name tables the schema does not have: ${ghosts.join(", ")}`).toEqual(
      [],
    );
  });

  it("gives every step an entry, so none is silently a no-op", () => {
    for (const step of DELETION_STEPS)
      expect(STEP_TABLES[step], `${step} has no table list`).toBeDefined();
    // Storage is the one step that clears no rows.
    const empty = DELETION_STEPS.filter((s) => STEP_TABLES[s].length === 0);
    expect(empty).toEqual(["storage_objects"]);
  });

  it("deletes dependents before the rows they point at", () => {
    const order = (step: DeletionStep) => DELETION_STEPS.indexOf(step);
    expect(order("messages")).toBeLessThan(order("conversations"));
    expect(order("knowledge_chunks")).toBeLessThan(order("knowledge_files"));
    expect(order("conversations")).toBeLessThan(order("contacts"));
    // Membership proves who was allowed to ask, so it goes near the end,
    // and the tenant row itself last of all.
    expect(order("memberships")).toBe(DELETION_STEPS.length - 2);
    expect(DELETION_STEPS[DELETION_STEPS.length - 1]).toBe("tenant");
  });
});

/** A client that counts deletes and can be told to fail on one table. */
function fakeAdmin(options: { failOn?: string } = {}) {
  const deleted: string[] = [];
  const state: Record<string, unknown> = {
    id: "d1",
    status: "requested",
    next_step: DELETION_STEPS[0],
    deleted_counts: {},
    attempts: 0,
    last_error: null,
  };
  const updates: Record<string, unknown>[] = [];

  const from = (table: string) => {
    if (table === "hc_workspace_deletions") {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.order = () => q;
      q.limit = () => q;
      q.maybeSingle = async () => ({ data: state, error: null });
      q.update = (payload: Record<string, unknown>) => {
        updates.push(payload);
        Object.assign(state, payload);
        const u: Record<string, unknown> = {};
        u.eq = () => u;
        (u as { then: unknown }).then = (res: (v: unknown) => unknown) =>
          Promise.resolve({ error: null }).then(res);
        return u;
      };
      return q;
    }
    return {
      delete: () => ({
        eq: async () => {
          if (options.failOn === table) return { count: null, error: { message: "boom" } };
          deleted.push(table);
          return { count: 3, error: null };
        },
      }),
    };
  };

  return { admin: { from } as never, deleted, state, updates };
}

describe("working through a deletion", () => {
  const storage = async () => 7;

  it("clears every step's tables and finishes", async () => {
    const { admin, deleted, state } = fakeAdmin();
    const result = await advanceDeletion(admin, "t1", storage);
    expect(result?.status).toBe("completed");
    expect(state.status).toBe("completed");
    for (const table of Object.values(STEP_TABLES).flat())
      expect(deleted, `${table} was not deleted`).toContain(table);
  });

  it("counts what it removed, including storage, and nothing else", async () => {
    const { admin } = fakeAdmin();
    const result = await advanceDeletion(admin, "t1", storage);
    expect(result?.deletedCounts["storage:workspace"]).toBe(7);
    expect(result?.deletedCounts["hc_messages"]).toBe(3);
    // Counts and nothing resembling content.
    for (const value of Object.values(result?.deletedCounts ?? {}))
      expect(typeof value).toBe("number");
  });

  it("stops at the failing step and says which one, so it can resume", async () => {
    const { admin, state } = fakeAdmin({ failOn: "hc_contacts" });
    const result = await advanceDeletion(admin, "t1", storage);
    expect(result?.status).toBe("failed");
    expect(result?.nextStep).toBe("contacts");
    expect(state.next_step).toBe("contacts");
    expect(String(state.last_error)).toContain("hc_contacts");
  });

  it("records progress after each step rather than only at the end", async () => {
    // An interruption should cost one step, not the whole run.
    const { admin, updates } = fakeAdmin();
    await advanceDeletion(admin, "t1", storage);
    expect(updates.length).toBe(DELETION_STEPS.length);
  });

  it("leaves a finished deletion alone", async () => {
    const { admin, state, deleted } = fakeAdmin();
    state.status = "completed";
    await advanceDeletion(admin, "t1", storage);
    expect(deleted).toEqual([]);
  });
});

describe("the lease, so two sweeps cannot delete at once", () => {
  const storage = async () => 7;

  it("holds the workspace while a run is working", async () => {
    const { admin, updates } = fakeAdmin();
    await advanceDeletion(admin, "t1", storage);
    // Every step but the last renews the lease.
    const held = updates.filter((u) => typeof u.locked_until === "string");
    expect(held.length).toBe(DELETION_STEPS.length - 1);
    expect(Date.parse(held[0]!.locked_until as string)).toBeGreaterThan(Date.now());
  });

  it("releases it when the run finishes", async () => {
    const { admin, state } = fakeAdmin();
    await advanceDeletion(admin, "t1", storage);
    expect(state.status).toBe("completed");
    expect(state.locked_until).toBeNull();
  });

  it("releases it when the run fails, so a retry is not blocked", async () => {
    const { admin, state } = fakeAdmin({ failOn: "hc_contacts" });
    await advanceDeletion(admin, "t1", storage);
    expect(state.status).toBe("failed");
    expect(state.locked_until).toBeNull();
  });
});

/** A client returning one page of deletion rows. */
function fakeLister(rows: { tenant_id: string; locked_until: string | null }[]) {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.in = () => q;
  q.order = () => q;
  q.limit = async () => ({ data: rows, error: null });
  return { from: () => q } as never;
}

describe("finding deletions to work on", () => {
  it("returns a workspace nobody is working on", async () => {
    const admin = fakeLister([{ tenant_id: "t1", locked_until: null }]);
    expect(await pendingDeletions(admin)).toEqual(["t1"]);
  });

  it("skips one whose lease is still live", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const admin = fakeLister([{ tenant_id: "t1", locked_until: future }]);
    expect(await pendingDeletions(admin)).toEqual([]);
  });

  it("takes back one whose lease expired, so a dead run does not block it", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const admin = fakeLister([{ tenant_id: "t1", locked_until: past }]);
    expect(await pendingDeletions(admin)).toEqual(["t1"]);
  });
});

/** A storage bucket of folders and files, two levels deep. */
function fakeStorage(tree: Record<string, { name: string; id: string | null }[]>) {
  const removed: string[] = [];
  const admin = {
    storage: {
      from: () => ({
        list: async (prefix: string, opts: { offset: number }) => ({
          data: opts.offset > 0 ? [] : (tree[prefix] ?? []),
          error: null,
        }),
        remove: async (paths: string[]) => {
          removed.push(...paths);
          return { error: null };
        },
      }),
    },
  } as never;
  return { admin, removed };
}

describe("removing a workspace's stored files", () => {
  it("walks into each folder and removes the files inside", async () => {
    const { admin, removed } = fakeStorage({
      t1: [{ name: "file-a", id: null }, { name: "file-b", id: null }],
      "t1/file-a": [{ name: "menu.pdf", id: "1" }],
      "t1/file-b": [{ name: "prices.csv", id: "2" }],
    });
    expect(await deleteTenantStorage(admin, "t1")).toBe(2);
    expect(removed.sort()).toEqual(["t1/file-a/menu.pdf", "t1/file-b/prices.csv"]);
  });

  it("counts nothing, and removes nothing, for a workspace with no files", async () => {
    const { admin, removed } = fakeStorage({});
    expect(await deleteTenantStorage(admin, "t1")).toBe(0);
    expect(removed).toEqual([]);
  });

  it("does not try to remove a folder as if it were a file", async () => {
    // A prefix comes back with a null id. Passing it to remove() would
    // silently do nothing and report a file deleted that still exists.
    const { admin, removed } = fakeStorage({
      t1: [{ name: "file-a", id: null }],
      "t1/file-a": [{ name: "menu.pdf", id: "1" }],
    });
    await deleteTenantStorage(admin, "t1");
    expect(removed).not.toContain("t1/file-a");
  });
});
