"use server";

import { redirect } from "next/navigation";

import {
  getWorkspaceContext,
  loadDocuments,
  saveDocument,
  type StoredDocument,
  type WorkspaceRole,
} from "@/lib/data/workspace";
import { readLiveConfig } from "@/lib/server/live-config";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  getTenantLimits,
  monthSpendMicroUsd,
  setLiveAiEnabled,
} from "@/lib/usage/ledger";
import { createClient } from "@/lib/supabase/server";
import {
  isWorkspaceDocumentKey,
  validateWorkspaceDocument,
  type WorkspaceDocumentKey,
} from "@/lib/workspace-documents";

export type WorkspaceSnapshot =
  | { status: "unavailable" }
  | { status: "signed_out" }
  | {
      status: "signed_in";
      email: string | null;
      workspaceName: string;
      role: WorkspaceRole;
      documents: Partial<Record<WorkspaceDocumentKey, StoredDocument>>;
    };

export async function loadWorkspace(): Promise<WorkspaceSnapshot> {
  if (!isSupabaseConfigured()) return { status: "unavailable" };
  try {
    const supabase = await createClient();
    const context = await getWorkspaceContext(supabase);
    if (!context) return { status: "signed_out" };
    return {
      status: "signed_in",
      email: context.email,
      workspaceName: context.tenantName,
      role: context.role,
      documents: await loadDocuments(supabase, context),
    };
  } catch {
    return { status: "unavailable" };
  }
}

export type SaveResult =
  | { ok: true; version: number }
  | {
      ok: false;
      reason: "signed_out" | "forbidden" | "invalid" | "conflict" | "error";
      current?: StoredDocument | null;
    };

export async function saveWorkspaceDocument(
  key: unknown,
  expectedVersion: unknown,
  document: unknown,
): Promise<SaveResult> {
  if (!isSupabaseConfigured()) return { ok: false, reason: "signed_out" };
  if (
    !isWorkspaceDocumentKey(key) ||
    typeof expectedVersion !== "number" ||
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 0
  )
    return { ok: false, reason: "invalid" };
  const normalized = validateWorkspaceDocument(key, document);
  if (normalized === null) return { ok: false, reason: "invalid" };

  try {
    const supabase = await createClient();
    const context = await getWorkspaceContext(supabase);
    if (!context) return { ok: false, reason: "signed_out" };
    if (context.role === "viewer") return { ok: false, reason: "forbidden" };
    return await saveDocument(
      supabase,
      context,
      key,
      expectedVersion,
      normalized,
    );
  } catch {
    return { ok: false, reason: "error" };
  }
}

export async function signOutOfDashboard() {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/app");
}

export type LiveAiStatus =
  | { state: "signed_out" }
  | {
      state: "not_configured";
      missing: ("openai_key" | "supabase_secret")[];
    }
  | {
      state: "ready";
      enabled: boolean;
      canManage: boolean;
      model: string;
      budgetMicroUsd: number;
      spentMicroUsd: number;
    };

export async function getLiveAiStatus(): Promise<LiveAiStatus> {
  if (!isSupabaseConfigured()) return { state: "signed_out" };
  try {
    const supabase = await createClient();
    const context = await getWorkspaceContext(supabase);
    if (!context) return { state: "signed_out" };
    const live = readLiveConfig();
    if (!live.ready) return { state: "not_configured", missing: live.missing };
    const admin = createAdminClient(live.config.supabaseSecretKey);
    const [limits, spent] = await Promise.all([
      getTenantLimits(admin, context.tenantId),
      monthSpendMicroUsd(admin, context.tenantId),
    ]);
    return {
      state: "ready",
      enabled: limits.liveAiEnabled,
      canManage: context.role === "owner",
      model: live.config.model,
      budgetMicroUsd: limits.monthlyBudgetMicroUsd,
      spentMicroUsd: spent,
    };
  } catch {
    return { state: "signed_out" };
  }
}

// Only the workspace owner can switch live AI on or off. The budget itself is
// never editable from the dashboard.
export async function updateLiveAi(enabled: unknown): Promise<LiveAiStatus> {
  if (typeof enabled !== "boolean") return getLiveAiStatus();
  if (!isSupabaseConfigured()) return { state: "signed_out" };
  const supabase = await createClient();
  const context = await getWorkspaceContext(supabase);
  if (!context) return { state: "signed_out" };
  const live = readLiveConfig();
  if (!live.ready) return { state: "not_configured", missing: live.missing };
  if (context.role === "owner")
    await setLiveAiEnabled(
      createAdminClient(live.config.supabaseSecretKey),
      context.tenantId,
      enabled,
    );
  return getLiveAiStatus();
}
