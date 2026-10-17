import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  workspaceDocumentKeys,
  type WorkspaceDocumentKey,
} from "@/lib/workspace-documents";

export type WorkspaceRole = "owner" | "operator" | "viewer";

export type WorkspaceContext = {
  userId: string;
  email: string | null;
  tenantId: string;
  tenantName: string;
  role: WorkspaceRole;
};

export type StoredDocument = { version: number; document: unknown };

// Identity always comes from the verified session; tenant from RLS-scoped membership.
export async function getWorkspaceContext(
  supabase: SupabaseClient,
): Promise<WorkspaceContext | null> {
  const { data: claimsData, error } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (error || !userId) return null;

  const { data: membership } = await supabase
    .from("hc_memberships")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!membership) return null;

  const { data: tenant } = await supabase
    .from("hc_tenants")
    .select("id, name")
    .eq("id", membership.tenant_id)
    .maybeSingle();
  if (!tenant) return null;

  return {
    userId,
    email:
      typeof claimsData.claims.email === "string"
        ? claimsData.claims.email
        : null,
    tenantId: tenant.id as string,
    tenantName: tenant.name as string,
    role: membership.role as WorkspaceRole,
  };
}

export async function loadDocuments(
  supabase: SupabaseClient,
  context: WorkspaceContext,
): Promise<Partial<Record<WorkspaceDocumentKey, StoredDocument>>> {
  const { data, error } = await supabase
    .from("hc_workspace_documents")
    .select("key, version, document")
    .eq("tenant_id", context.tenantId)
    .in("key", [...workspaceDocumentKeys]);
  if (error) throw new Error("Could not load workspace documents.");
  const result: Partial<Record<WorkspaceDocumentKey, StoredDocument>> = {};
  for (const row of data ?? [])
    result[row.key as WorkspaceDocumentKey] = {
      version: Number(row.version),
      document: row.document,
    };
  return result;
}

export type SaveOutcome =
  | { ok: true; version: number }
  | { ok: false; reason: "conflict"; current: StoredDocument | null }
  | { ok: false; reason: "error" };

// Compare-and-swap write. expectedVersion 0 means "create".
export async function saveDocument(
  supabase: SupabaseClient,
  context: WorkspaceContext,
  key: WorkspaceDocumentKey,
  expectedVersion: number,
  document: unknown,
): Promise<SaveOutcome> {
  if (expectedVersion === 0) {
    const { error } = await supabase.from("hc_workspace_documents").insert({
      tenant_id: context.tenantId,
      key,
      document,
      updated_by: context.userId,
    });
    if (!error) return { ok: true, version: 1 };
    if (error.code === "23505") return conflict(supabase, context, key);
    return { ok: false, reason: "error" };
  }

  const { data, error } = await supabase
    .from("hc_workspace_documents")
    .update({
      document,
      version: expectedVersion + 1,
      updated_by: context.userId,
    })
    .eq("tenant_id", context.tenantId)
    .eq("key", key)
    .eq("version", expectedVersion)
    .select("version");
  if (error) return { ok: false, reason: "error" };
  if (!data || data.length === 0) return conflict(supabase, context, key);
  return { ok: true, version: Number(data[0].version) };
}

async function conflict(
  supabase: SupabaseClient,
  context: WorkspaceContext,
  key: WorkspaceDocumentKey,
): Promise<SaveOutcome> {
  const { data } = await supabase
    .from("hc_workspace_documents")
    .select("version, document")
    .eq("tenant_id", context.tenantId)
    .eq("key", key)
    .maybeSingle();
  return {
    ok: false,
    reason: "conflict",
    current: data
      ? { version: Number(data.version), document: data.document }
      : null,
  };
}
