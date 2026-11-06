import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every tenant table keeps row-level security on.
 *
 * Read from the migration files rather than a database, so it runs in CI
 * with no credentials and no service container. That makes it a guard
 * against the mistake that actually happens — a new table added without
 * RLS, or granted to `authenticated` with no policy to constrain it — and
 * nothing more. It cannot tell you a policy is *correct*: whether
 * `is_active_member` really keeps one tenant out of another's rows is a
 * behavioural question, and answering it needs a real Postgres.
 *
 * The live database was checked by hand once (ROADMAP, 2026-10-17). This
 * is what stops the next table from slipping through unchecked.
 */

const DIR = join(process.cwd(), "supabase", "migrations");

const sql = readdirSync(DIR)
  .filter((name) => name.endsWith(".sql"))
  .map((name) => ({ name, text: readFileSync(join(DIR, name), "utf8") }));

const all = sql.map((file) => file.text).join("\n");

/**
 * Each create-table statement's body, read by balancing parentheses.
 *
 * Not "up to the first `);`": column checks are full of brackets, and a
 * check that happened to end in `);` would silently truncate the body and
 * make every rule below pass on half a table.
 */
const bodies = new Map<string, string>();
for (const match of all.matchAll(
  /create table (?:if not exists )?public\.(hc_\w+)\s*\(/g,
)) {
  const open = match.index! + match[0].length - 1;
  let depth = 0;
  for (let i = open; i < all.length; i += 1) {
    if (all[i] === "(") depth += 1;
    else if (all[i] === ")") {
      depth -= 1;
      if (depth === 0) {
        bodies.set(match[1], all.slice(open + 1, i));
        break;
      }
    }
  }
}

/** Tables created anywhere in the migration history. */
const tables = [...bodies.keys()].sort();

/** The primary key's columns, whether declared inline or as a constraint. */
function primaryKeyOf(body: string): string[] {
  const asConstraint = /primary key \(([^)]*)\)/.exec(body);
  if (asConstraint)
    return asConstraint[1].split(",").map((part) => part.trim());
  const inline = /^\s*(\w+)[^,\n]*\bprimary key\b/m.exec(body);
  return inline ? [inline[1]] : [];
}

/**
 * Tables whose primary key starts with tenant_id.
 *
 * The shape takes several forms — (tenant_id, id), (tenant_id, user_id),
 * (tenant_id, key), (tenant_id, workflow_id, version), or tenant_id alone
 * — and what matters is the same in all of them: there is no bare unique
 * id, so Postgres will not accept a single-column foreign key pointing at
 * one. Every reference has to carry the tenant.
 */
const tenantKeyed = new Set(
  tables.filter((table) => primaryKeyOf(bodies.get(table) ?? "")[0] === "tenant_id"),
);

/** Foreign keys declared as a table constraint, i.e. the composite ones. */
function compositeReferences(body: string) {
  return [
    ...body.matchAll(
      /foreign key \(([^)]*)\)\s*\n?\s*references public\.(hc_\w+)\(([^)]*)\)/g,
    ),
  ].map((match) => ({
    columns: match[1].split(",").map((part) => part.trim()),
    target: match[2],
    targetColumns: match[3].split(",").map((part) => part.trim()),
  }));
}

/**
 * References written inline on a column, which can only be single-column.
 *
 * Found by removing the table-constraint ones first, so what is left is
 * exactly the `col uuid references public.x(y)` form.
 */
function inlineReferences(body: string) {
  const withoutComposite = body.replace(
    /foreign key \([^)]*\)\s*\n?\s*references public\.hc_\w+\([^)]*\)/g,
    "",
  );
  return [
    ...withoutComposite.matchAll(/references public\.(hc_\w+)\(([^)]*)\)/g),
  ].map((match) => ({ target: match[1], targetColumns: match[2].trim() }));
}

/**
 * Tables the server owns outright.
 *
 * These have no policies on purpose: nothing but the service role touches
 * them, so a policy for `authenticated` would widen access rather than
 * limit it. RLS still has to be on and forced, which is what keeps that
 * true.
 */
const SERVICE_ONLY = new Set([
  "hc_checkpoints",
  "hc_usage_reservations",
  "hc_tenant_limits",
  // Webhook de-duplication: (provider, event_id) pairs already handled.
  "hc_webhook_events",
]);

/**
 * Tables whose default grants to public/anon/authenticated are revoked.
 *
 * Built by reading the statements rather than grepping per table, because
 * all three shapes are in use: the foundation revokes the whole schema,
 * later migrations revoke one table, and the conversations migration
 * revokes four in a single statement.
 */
const revokedFromUntrusted = (() => {
  const revoked = new Set<string>();
  const schemaWide = sql.find((file) =>
    /revoke all on all tables in schema public from[^;]*\bauthenticated\b/.test(
      file.text,
    ),
  );
  if (schemaWide)
    for (const match of schemaWide.text.matchAll(
      /create table (?:if not exists )?public\.(hc_\w+)/g,
    ))
      revoked.add(match[1]);

  for (const match of all.matchAll(
    /revoke all on ((?:\s*public\.hc_\w+\s*,?)+)\s*from ([^;]+);/g,
  )) {
    const [, list, roles] = match;
    if (!/\bauthenticated\b/.test(roles)) continue;
    for (const table of list.matchAll(/public\.(hc_\w+)/g)) revoked.add(table[1]);
  }
  return revoked;
})();

describe("the migrations keep row-level security on", () => {
  it("found the tables to check", () => {
    // A regex that silently matches nothing would make everything below
    // pass without testing anything.
    expect(tables.length).toBeGreaterThan(15);
    expect(tables).toContain("hc_tenants");
    expect(tables).toContain("hc_appointments");
  });

  it.each(tables)("%s has RLS enabled", (table) => {
    expect(all).toContain(`alter table public.${table} enable row level security`);
  });

  it.each(tables)("%s forces RLS, so the owning role is not exempt", (table) => {
    // Without `force`, the table owner bypasses every policy — which is
    // the role migrations themselves run as.
    expect(all).toContain(`alter table public.${table} force row level security`);
  });

  it.each(tables)("%s has the default grants revoked", (table) => {
    // Three shapes are all correct and all in use: the foundation's
    // schema-wide statement, a revoke naming one table, and one naming
    // several. Only the third tripped this check when it was written —
    // which is the point of parsing the statements rather than grepping.
    expect(revokedFromUntrusted.has(table), `${table} keeps its default grants`).toBe(
      true,
    );
  });

  it.each(tables.filter((table) => !SERVICE_ONLY.has(table)))(
    "%s has at least one policy",
    (table) => {
      // A table with RLS on and no policy denies everyone, which is safe
      // but means the feature using it is broken. Service-owned tables are
      // the deliberate exception, listed above.
      expect(all).toMatch(new RegExp(`create policy \\w+ on public\\.${table}`));
    },
  );

  it.each([...SERVICE_ONLY])("%s stays server-only, with no policy", (table) => {
    // A typo here would excuse a table that does not exist while quietly
    // leaving a real one unchecked, so the name is confirmed first.
    expect(tables, `${table} is not a table`).toContain(table);
    expect(all).not.toMatch(new RegExp(`create policy \\w+ on public\\.${table}`));
  });

  it("never grants a write to anon", () => {
    const granted = [...all.matchAll(/grant ([^;]+?) on public\.(hc_\w+) to ([^;]+);/g)];
    for (const [, privileges, table, roles] of granted)
      if (/\banon\b/.test(roles))
        expect(
          /insert|update|delete|all/i.test(privileges),
          `${table} grants "${privileges.trim()}" to anon`,
        ).toBe(false);
  });

  it("gives every tenant table a tenant_id to scope by", () => {
    // hc_tenants is the tenant; the chunk tables hang off a parent row and
    // are scoped through it; hc_webhook_events holds no tenant data at all,
    // only (provider, event_id) pairs already seen, so there is nothing in
    // it to leak between workspaces.
    const scopedElsewhere = new Set([
      "hc_tenants",
      "hc_knowledge_chunks",
      "hc_knowledge_file_chunks",
      "hc_knowledge_source_versions",
      "hc_webhook_events",
    ]);
    for (const table of tables) {
      if (scopedElsewhere.has(table)) continue;
      const body = all.slice(
        all.indexOf(`create table public.${table}`),
        all.indexOf(");", all.indexOf(`create table public.${table}`)),
      );
      expect(body, `${table} has no tenant_id`).toContain("tenant_id");
    }
  });
});

describe("foreign keys carry the tenant", () => {
  /*
   * The rule this file was missing. hc_appointments shipped with
   *
   *   conversation_id uuid references public.hc_conversations(id)
   *
   * which Postgres refused, because hc_conversations is keyed
   * (tenant_id, id) and has no bare unique id to point at. The refusal was
   * the protection working — but had the target happened to have a plain
   * unique id, that reference would have compiled and quietly allowed a
   * row to name another workspace's conversation.
   *
   * Everything here checks the schema keeps making that impossible rather
   * than relying on it having been impossible once.
   */

  it("found tables keyed by tenant to check against", () => {
    // A parser that quietly matched nothing would make every rule below
    // pass without reading a single key.
    expect(tenantKeyed.size).toBeGreaterThan(10);
    expect(tenantKeyed.has("hc_conversations")).toBe(true);
    expect(tenantKeyed.has("hc_appointments")).toBe(true);
    expect(tenantKeyed.has("hc_tenants")).toBe(false);
  });

  it.each(tables)("%s never points at a tenant table with a bare id", (table) => {
    const offending = inlineReferences(bodies.get(table) ?? "").filter((ref) =>
      tenantKeyed.has(ref.target),
    );
    expect(
      offending.map((ref) => `${ref.target}(${ref.targetColumns})`),
      `${table} references a tenant-keyed table without carrying tenant_id`,
    ).toEqual([]);
  });

  it.each(tables)("%s names tenant_id first on both sides of a key", (table) => {
    // Not "(tenant_id, id)": the targets are legitimately varied —
    // (tenant_id, source_id, version), (tenant_id, conversation_id). What
    // has to hold everywhere is that the tenant travels with the
    // reference, which is the first column on each side.
    for (const ref of compositeReferences(bodies.get(table) ?? "")) {
      expect(ref.columns[0], `${table} -> ${ref.target}`).toBe("tenant_id");
      expect(ref.targetColumns[0], `${table} -> ${ref.target}`).toBe("tenant_id");
    }
  });

  it.each(tables)("%s keys itself by tenant when it holds tenant rows", (table) => {
    // hc_tenants is the tenant itself, so its key is its id; and
    // hc_webhook_events holds no tenant data at all.
    if (table === "hc_tenants" || table === "hc_webhook_events") return;
    expect(
      primaryKeyOf(bodies.get(table) ?? "")[0],
      `${table} does not lead its primary key with tenant_id`,
    ).toBe("tenant_id");
  });
});

describe("migration hygiene", () => {
  it("names every file so they apply in order", () => {
    for (const file of sql)
      expect(file.name, file.name).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
  });

  it("applies them in a single order, with no duplicate timestamps", () => {
    const stamps = sql.map((file) => file.name.slice(0, 14));
    expect(new Set(stamps).size).toBe(stamps.length);
  });
});
