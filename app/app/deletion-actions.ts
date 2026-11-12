"use server";

import { getWorkspaceContext } from "@/lib/data/workspace";
import {
  DELETION_STEPS,
  currentDeletion,
  requestDeletion,
} from "@/lib/server/workspace-deletion";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

/**
 * Letting an owner delete their workspace.
 *
 * Starting one is a server action that re-checks the role, never an insert
 * the browser can make. Two gates sit in front of it: only an owner may ask,
 * and they must type the workspace's own name, so a misplaced click cannot
 * destroy a business's data.
 *
 * The work itself is not done here. A request is recorded and the sweep at
 * /api/cron/workspace-deletions works through it, because deletion reaches
 * storage as well as rows and must survive being interrupted. Doing it in
 * an unfinished background promise is exactly the failure this avoids.
 *
 * This is a control that removes a workspace's data from this system. It is
 * not a claim of compliance with any particular law.
 */
export type DeletionSnapshot =
  | { state: "unavailable" }
  | { state: "signed_out" }
  | { state: "not_owner" }
  | { state: "none"; workspaceName: string }
  | {
      state: "in_progress" | "completed" | "failed";
      workspaceName: string;
      stepsDone: number;
      stepsTotal: number;
      removed: number;
      lastError: string | null;
    };

function admin() {
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  return secret ? createAdminClient(secret) : null;
}

/** Rows cleared so far, as one number the owner can read. */
function removedCount(counts: Record<string, number>) {
  return Object.values(counts).reduce((total, n) => total + (n || 0), 0);
}

export async function getWorkspaceDeletion(): Promise<DeletionSnapshot> {
  if (!isSupabaseConfigured()) return { state: "unavailable" };
  try {
    const supabase = await createClient();
    const context = await getWorkspaceContext(supabase);
    if (!context) return { state: "signed_out" };
    // Only an owner may even see this. The table's policy says the same;
    // this is the second of the two, not the only one.
    if (context.role !== "owner") return { state: "not_owner" };

    // Read through the owner's own client, so RLS decides.
    const state = await currentDeletion(supabase, context.tenantId);
    if (!state) return { state: "none", workspaceName: context.tenantName };

    const stepsDone = Math.max(0, DELETION_STEPS.indexOf(state.nextStep));
    return {
      state:
        state.status === "completed"
          ? "completed"
          : state.status === "failed"
            ? "failed"
            : "in_progress",
      workspaceName: context.tenantName,
      stepsDone: state.status === "completed" ? DELETION_STEPS.length : stepsDone,
      stepsTotal: DELETION_STEPS.length,
      removed: removedCount(state.deletedCounts),
      lastError: state.lastError,
    };
  } catch {
    return { state: "signed_out" };
  }
}

export type DeletionRequestResult =
  | { ok: true }
  | { ok: false; reason: "signed_out" | "not_owner" | "mismatch" | "unavailable" };

export async function requestWorkspaceDeletion(
  confirmation: unknown,
): Promise<DeletionRequestResult> {
  if (!isSupabaseConfigured()) return { ok: false, reason: "unavailable" };
  const supabase = await createClient();
  const context = await getWorkspaceContext(supabase);
  if (!context) return { ok: false, reason: "signed_out" };
  if (context.role !== "owner") return { ok: false, reason: "not_owner" };

  // The typed name must match, and it is compared against the workspace the
  // session resolved to — not against anything the browser sent.
  const typed = typeof confirmation === "string" ? confirmation.trim() : "";
  if (typed !== context.tenantName.trim()) return { ok: false, reason: "mismatch" };

  const service = admin();
  if (!service) return { ok: false, reason: "unavailable" };

  const result = await requestDeletion(service, context.tenantId, context.userId);
  return result.ok ? { ok: true } : { ok: false, reason: "unavailable" };
}
