import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CopilotActionMeta } from "@/lib/copilot/contracts";
import type { WorkspaceContext } from "@/lib/data/workspace";

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
  return entry;
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
