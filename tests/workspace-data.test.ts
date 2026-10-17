import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { saveDocument, type WorkspaceContext } from "../lib/data/workspace";

const context: WorkspaceContext = {
  userId: "u1",
  email: "owner@example.com",
  tenantId: "t1",
  tenantName: "Test workspace",
  role: "owner",
};

// Minimal in-memory stand-in for the PostgREST query builder, enforcing the
// same compare-and-swap rule as the database trigger.
function fakeSupabase(initial?: { version: number; document: unknown }) {
  let row = initial ? { ...initial } : null;
  const calls: string[] = [];
  const client = {
    from() {
      const filters: Record<string, unknown> = {};
      let op: "insert" | "update" | "select" = "select";
      let payload: Record<string, unknown> = {};
      const builder = {
        insert(values: Record<string, unknown>) {
          calls.push("insert");
          if (row) return Promise.resolve({ error: { code: "23505" } });
          row = { version: 1, document: values.document };
          return Promise.resolve({ error: null });
        },
        update(values: Record<string, unknown>) {
          op = "update";
          payload = values;
          return builder;
        },
        select() {
          if (op === "update") {
            calls.push("update");
            if (!row || filters.version !== row.version)
              return Promise.resolve({ data: [], error: null });
            row = {
              version: Number(payload.version),
              document: payload.document,
            };
            return Promise.resolve({
              data: [{ version: row.version }],
              error: null,
            });
          }
          return builder;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({ data: row, error: null });
        },
      };
      return builder;
    },
  };
  return { client: client as never, calls, current: () => row };
}

describe("workspace document saves", () => {
  it("creates the first version, then advances by one", async () => {
    const db = fakeSupabase();
    expect(
      await saveDocument(db.client, context, "knowledge", 0, { a: 1 }),
    ).toEqual({ ok: true, version: 1 });
    expect(
      await saveDocument(db.client, context, "knowledge", 1, { a: 2 }),
    ).toEqual({ ok: true, version: 2 });
    expect(db.current()).toEqual({ version: 2, document: { a: 2 } });
  });

  it("reports a conflict with the newer copy instead of overwriting it", async () => {
    const db = fakeSupabase({ version: 5, document: { newer: true } });
    expect(
      await saveDocument(db.client, context, "workflows", 3, { stale: true }),
    ).toEqual({
      ok: false,
      reason: "conflict",
      current: { version: 5, document: { newer: true } },
    });
    expect(
      await saveDocument(db.client, context, "workflows", 0, { dup: true }),
    ).toMatchObject({
      ok: false,
      reason: "conflict",
    });
    expect(db.current()).toEqual({ version: 5, document: { newer: true } });
  });
});
