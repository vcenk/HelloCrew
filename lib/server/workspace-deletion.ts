import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Deleting a workspace, in resumable steps.
 *
 * Not one cascading delete, because deletion reaches storage objects and
 * provider tokens as well as rows, and those cannot share a transaction with
 * the database work. Recorded steps mean a run that dies halfway can be
 * resumed, and the owner can be told where it actually got to.
 *
 * The evidence kept is counts and timestamps. Keeping a copy of what was
 * deleted in order to prove it was deleted would defeat the point.
 *
 * This does not claim compliance with any particular law. It is a control
 * that does what it says: it removes the workspace's data from this system.
 */

/**
 * Every step, in order.
 *
 * Ordered so that rows pointing at other rows go first. The composite
 * foreign keys would mostly handle this through cascade, but doing it
 * explicitly means the counts are honest about what was removed rather than
 * reporting zero for a table the database quietly emptied.
 *
 * A table missing from this list is a table that silently survives deletion,
 * which is the failure worth guarding; `tests/workspace-deletion.test.ts`
 * checks this list against the tenant tables the migrations actually define.
 */
export const DELETION_STEPS = [
  // Conversation data, deepest first.
  "messages",
  "approvals",
  "conversations",
  // People and what they left behind.
  "leads",
  "contacts",
  "appointments",
  // Knowledge, including the derived chunks and the stored files.
  "knowledge_chunks",
  "knowledge_files",
  "knowledge",
  "storage_objects",
  // Everything the workspace configured.
  "business_profile",
  "workflow_versions",
  "workflow_documents",
  "public_replies",
  "widget_installations",
  "channel_connections",
  "notification_settings",
  "tenant_limits",
  "usage_reservations",
  "checkpoints",
  "audit_events",
  // Membership last: it is what proves who was allowed to ask for this.
  "memberships",
  "tenant",
] as const;

export type DeletionStep = (typeof DELETION_STEPS)[number];

/** Tables each step clears. Storage is handled separately, by prefix. */
export const STEP_TABLES: Record<DeletionStep, string[]> = {
  messages: ["hc_messages"],
  approvals: ["hc_approvals"],
  conversations: ["hc_conversations"],
  leads: ["hc_leads"],
  contacts: ["hc_contacts"],
  appointments: ["hc_appointments"],
  knowledge_chunks: ["hc_knowledge_chunks", "hc_knowledge_file_chunks"],
  knowledge_files: ["hc_knowledge_files"],
  knowledge: ["hc_knowledge_sources", "hc_knowledge_source_versions"],
  storage_objects: [],
  business_profile: ["hc_business_profiles"],
  // Versions point at the workflow, so they go first.
  workflow_versions: ["hc_workflow_versions"],
  workflow_documents: ["hc_workflows", "hc_workspace_documents"],
  public_replies: ["hc_public_replies"],
  // The installation is what a customer's browser talks to. Removing it is
  // what actually stops the widget answering for a deleted workspace.
  widget_installations: ["hc_widget_installations"],
  channel_connections: ["hc_channel_connections"],
  notification_settings: ["hc_notification_settings"],
  tenant_limits: ["hc_tenant_limits"],
  usage_reservations: ["hc_usage_reservations"],
  checkpoints: ["hc_checkpoints"],
  audit_events: ["hc_audit_events"],
  memberships: ["hc_memberships"],
  tenant: ["hc_tenants"],
};

export type DeletionState = {
  id: string;
  status: "requested" | "running" | "completed" | "failed";
  nextStep: DeletionStep;
  deletedCounts: Record<string, number>;
  attempts: number;
  lastError: string | null;
};

/**
 * Ask for a workspace to be deleted.
 *
 * Authorization is the caller's job and is re-checked there: this takes a
 * tenant id and trusts it, which is why nothing reachable from a browser
 * calls it directly. The unique index means a second request joins the run
 * already in progress instead of starting a competing one.
 */
export async function requestDeletion(
  admin: SupabaseClient,
  tenantId: string,
  requestedBy: string | null,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const existing = await currentDeletion(admin, tenantId);
  if (existing && (existing.status === "requested" || existing.status === "running"))
    return { ok: true, id: existing.id };

  const { data, error } = await admin
    .from("hc_workspace_deletions")
    .insert({
      tenant_id: tenantId,
      requested_by: requestedBy,
      next_step: DELETION_STEPS[0],
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, reason: "Couldn’t record the request." };
  return { ok: true, id: (data as { id: string }).id };
}

/** What the owner is shown: whether deletion was asked for, and how far it got. */
export async function currentDeletion(
  db: SupabaseClient,
  tenantId: string,
): Promise<DeletionState | null> {
  const { data } = await db
    .from("hc_workspace_deletions")
    .select("id, status, next_step, deleted_counts, attempts, last_error")
    .eq("tenant_id", tenantId)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    status: row.status as DeletionState["status"],
    nextStep: row.next_step as DeletionStep,
    deletedCounts: (row.deleted_counts as Record<string, number>) ?? {},
    attempts: Number(row.attempts ?? 0),
    lastError: (row.last_error as string) ?? null,
  };
}

/**
 * Work through the remaining steps.
 *
 * Each step commits its own progress, so an interruption costs at most one
 * step rather than the whole run. Deleting something already gone is not an
 * error: a resumed run re-entering a finished step simply counts zero.
 */
export async function advanceDeletion(
  admin: SupabaseClient,
  tenantId: string,
  deleteStoragePrefix: (tenantId: string) => Promise<number>,
): Promise<DeletionState | null> {
  const state = await currentDeletion(admin, tenantId);
  if (!state || state.status === "completed" || state.status === "failed") return state;

  const counts = { ...state.deletedCounts };
  const from = DELETION_STEPS.indexOf(state.nextStep);
  const steps = DELETION_STEPS.slice(from < 0 ? 0 : from);

  for (const step of steps) {
    try {
      if (step === "storage_objects") {
        counts["storage:workspace"] = await deleteStoragePrefix(tenantId);
      } else {
        for (const table of STEP_TABLES[step]) {
          const { count, error } = await admin
            .from(table)
            .delete({ count: "exact" })
            .eq(table === "hc_tenants" ? "id" : "tenant_id", tenantId);
          if (error) throw new Error(`${table}: ${error.message}`);
          counts[table] = (counts[table] ?? 0) + (count ?? 0);
        }
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown";
      await admin
        .from("hc_workspace_deletions")
        .update({
          status: "failed",
          next_step: step,
          deleted_counts: counts,
          last_error: reason.slice(0, 300),
          attempts: state.attempts + 1,
        })
        .eq("tenant_id", tenantId)
        .eq("id", state.id);
      return { ...state, status: "failed", nextStep: step, deletedCounts: counts, lastError: reason };
    }

    // Progress is written per step, not at the end: an interruption here
    // should cost one step, not the whole run.
    const done = DELETION_STEPS.indexOf(step) + 1;
    const next = DELETION_STEPS[done] ?? step;
    await admin
      .from("hc_workspace_deletions")
      .update({
        status: done >= DELETION_STEPS.length ? "completed" : "running",
        next_step: next,
        deleted_counts: counts,
        started_at: new Date().toISOString(),
        ...(done >= DELETION_STEPS.length ? { completed_at: new Date().toISOString() } : {}),
      })
      .eq("tenant_id", tenantId)
      .eq("id", state.id);
  }

  return {
    ...state,
    status: "completed",
    nextStep: DELETION_STEPS[DELETION_STEPS.length - 1],
    deletedCounts: counts,
  };
}
