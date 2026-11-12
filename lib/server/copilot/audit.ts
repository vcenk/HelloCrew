import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";

import type { CopilotActionMeta } from "@/lib/copilot/contracts";
import type { WorkspaceContext } from "@/lib/data/workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * Records that an owner action happened.
 *
 * Both a structured log line and a row in hc_audit_events. The log is for
 * whoever is reading server output; the row is what the owner can be shown,
 * is scoped to their workspace by RLS, and survives.
 *
 * Nothing here writes the content of a document or a customer's details: an
 * audit line says who did what to which resource, not what it said. `reason`
 * is for a refusal code or a short provider message, and is bounded in the
 * schema so a future caller cannot quietly turn it into a content field.
 */
export type CopilotAuditEvent = {
  event: string;
  tenantId: string;
  userId: string;
  role: string;
  action: string;
  safety: string;
  resource: string;
  outcome: "applied" | "partial" | "rejected" | "failed" | "draft" | "refused";
  /** Counts only — never the text that was added. */
  applied?: number;
  skipped?: number;
  reason?: string;
  at: string;
};

export function recordCopilotAudit(
  workspace: Pick<WorkspaceContext, "tenantId" | "userId" | "role">,
  action: Pick<CopilotActionMeta, "name" | "safety" | "resource" | "audit">,
  outcome: CopilotAuditEvent["outcome"],
  detail: { applied?: number; skipped?: number; reason?: string } = {},
): CopilotAuditEvent {
  const entry: CopilotAuditEvent = {
    event: action.audit.event,
    tenantId: workspace.tenantId,
    userId: workspace.userId,
    role: workspace.role,
    action: action.name,
    safety: action.safety,
    resource: action.resource,
    outcome,
    ...detail,
    at: new Date().toISOString(),
  };
  console.info("[copilot.audit]", JSON.stringify(entry));

  // The durable row, scheduled rather than awaited.
  //
  // Awaiting it would let a failed audit write delay — or, if it threw,
  // undo — an action the owner already approved. `after` also runs when the
  // action throws, redirects, or calls notFound, which is what keeps refused
  // and failed outcomes on the record rather than only the successful ones.
  //
  // Called here rather than at each of the fourteen call sites: a new action
  // added later gets the row by writing its log line, with nothing to
  // remember. That is the whole reason this sits in the shared helper.
  scheduleAuditRow(entry);
  return entry;
}

/**
 * A service-role client for the audit insert, or null when unconfigured.
 *
 * Local rather than reusing `widgetAdminClient`, which is documented as the
 * client for anonymous website traffic and pulls the widget and agent modules
 * in behind it. The guard is the same two lines.
 */
function auditAdminClient(): SupabaseClient | null {
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!secret || !isSupabaseConfigured()) return null;
  return createAdminClient(secret);
}

/**
 * Hands the row to `after`, and stays quiet if there is no request to be
 * after.
 *
 * `after` throws when called outside a request context, which a cron, a
 * script or a test legitimately is. Those callers still get the log line, so
 * the behaviour there is exactly what it was before this table existed — the
 * audit row is an addition, not a new way for an action to fail.
 */
function scheduleAuditRow(entry: CopilotAuditEvent) {
  try {
    after(async () => {
      const admin = auditAdminClient();
      // No secret key: the log line above is the only record, same as before.
      if (!admin) return;
      await storeAuditEvent(admin, entry);
    });
  } catch {
    // Not in a request. Nothing to schedule against, and nothing is wrong.
  }
}

/**
 * The same record, kept where the owner can see it.
 *
 * Deliberately not awaited by callers that are completing a user action: an
 * audit write failing must not undo work the owner already approved. The
 * failure is logged loudly instead, because an action happening with no
 * record of it is worth knowing about.
 */
export async function storeAuditEvent(
  admin: SupabaseClient,
  entry: CopilotAuditEvent,
): Promise<boolean> {
  const { error } = await admin.from("hc_audit_events").insert({
    tenant_id: entry.tenantId,
    actor_user_id: entry.userId || null,
    actor_role: entry.role?.slice(0, 40) ?? null,
    event: entry.event.slice(0, 80),
    action: entry.action.slice(0, 80),
    resource: entry.resource.slice(0, 120),
    safety: entry.safety,
    outcome: entry.outcome,
    applied_count: entry.applied ?? null,
    skipped_count: entry.skipped ?? null,
    // Bounded here as well as in the schema, so a long provider message is
    // trimmed rather than losing the whole record to a constraint.
    reason: entry.reason ? entry.reason.slice(0, 200) : null,
  });
  if (error) {
    console.error("[copilot.audit] not stored:", error.message);
    return false;
  }
  return true;
}

/**
 * What the owner sees: the workspace's recent history, newest first.
 *
 * Reads through the caller's own session rather than the service role, so
 * RLS decides what they may see instead of this function being trusted to.
 */
export async function recentAuditEvents(
  db: SupabaseClient,
  tenantId: string,
  limit = 50,
): Promise<CopilotAuditEvent[]> {
  const { data, error } = await db
    .from("hc_audit_events")
    .select(
      "event, action, resource, safety, outcome, applied_count, skipped_count, reason, actor_user_id, actor_role, created_at",
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(1, limit), 200));
  if (error) {
    console.error("[copilot.audit] could not read:", error.message);
    return [];
  }
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    event: String(row.event),
    tenantId,
    userId: (row.actor_user_id as string) ?? "",
    role: (row.actor_role as string) ?? "",
    action: String(row.action),
    safety: String(row.safety),
    resource: String(row.resource),
    outcome: row.outcome as CopilotAuditEvent["outcome"],
    ...(row.applied_count === null ? {} : { applied: Number(row.applied_count) }),
    ...(row.skipped_count === null ? {} : { skipped: Number(row.skipped_count) }),
    ...(row.reason === null ? {} : { reason: String(row.reason) }),
    at: String(row.created_at),
  }));
}
