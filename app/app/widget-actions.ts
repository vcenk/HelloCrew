"use server";

import { z } from "zod";

import { getWorkspaceContext } from "@/lib/data/workspace";
import { forgetInstallation, newPublicWidgetId } from "@/lib/server/widget-installations";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { normalizeOrigin } from "@/lib/widget";

export type WebsiteChat = {
  publicId: string;
  allowedOrigins: string[];
  enabled: boolean;
};

export type WebsiteChatResult =
  | { ok: true; chat: WebsiteChat | null }
  | { ok: false; reason: "signed_out" | "forbidden" | "invalid" | "error"; error: string };

async function session() {
  if (!isSupabaseConfigured()) return null;
  const db = await createClient();
  const workspace = await getWorkspaceContext(db);
  return workspace ? { db, workspace } : null;
}

function toChat(row: Record<string, unknown>): WebsiteChat {
  return {
    publicId: row.public_id as string,
    allowedOrigins: (row.allowed_origins as string[]) ?? [],
    enabled: Boolean(row.enabled),
  };
}

export async function getWebsiteChat(): Promise<WebsiteChatResult> {
  try {
    const s = await session();
    if (!s) return { ok: false, reason: "signed_out", error: "Sign in to set up your website chat." };
    const { data, error } = await s.db
      .from("hc_widget_installations")
      .select("public_id, allowed_origins, enabled")
      .eq("tenant_id", s.workspace.tenantId)
      .maybeSingle();
    if (error) throw error;
    return { ok: true, chat: data ? toChat(data) : null };
  } catch {
    return { ok: false, reason: "error", error: "Couldn’t load your website chat." };
  }
}

export async function createWebsiteChat(): Promise<WebsiteChatResult> {
  try {
    const s = await session();
    if (!s) return { ok: false, reason: "signed_out", error: "Sign in to set up your website chat." };
    if (s.workspace.role === "viewer")
      return { ok: false, reason: "forbidden", error: "Only owners and operators can set this up." };
    const existing = await getWebsiteChat();
    if (existing.ok && existing.chat) return existing;
    const { data, error } = await s.db
      .from("hc_widget_installations")
      .insert({
        tenant_id: s.workspace.tenantId,
        public_id: newPublicWidgetId(),
        created_by: s.workspace.userId,
      })
      .select("public_id, allowed_origins, enabled")
      .single();
    if (error) throw error;
    return { ok: true, chat: toChat(data) };
  } catch {
    return { ok: false, reason: "error", error: "Couldn’t create your website chat." };
  }
}

const updateSchema = z
  .object({
    allowedOrigins: z.array(z.string().max(200)).max(10),
    enabled: z.boolean(),
  })
  .strict();

export async function updateWebsiteChat(input: {
  allowedOrigins: string[];
  enabled: boolean;
}): Promise<WebsiteChatResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid", error: "Up to 10 websites." };
  const origins: string[] = [];
  for (const raw of parsed.data.allowedOrigins) {
    const origin = normalizeOrigin(raw);
    if (!origin) return { ok: false, reason: "invalid", error: `“${raw}” isn’t a website address like https://example.com.` };
    if (!origins.includes(origin)) origins.push(origin);
  }
  try {
    const s = await session();
    if (!s) return { ok: false, reason: "signed_out", error: "Sign in to set up your website chat." };
    if (s.workspace.role === "viewer")
      return { ok: false, reason: "forbidden", error: "Only owners and operators can change this." };
    const { data, error } = await s.db
      .from("hc_widget_installations")
      .update({ allowed_origins: origins, enabled: parsed.data.enabled })
      .eq("tenant_id", s.workspace.tenantId)
      .select("public_id, allowed_origins, enabled")
      .single();
    if (error) throw error;
    const chat = toChat(data);
    forgetInstallation(chat.publicId);
    return { ok: true, chat };
  } catch {
    return { ok: false, reason: "error", error: "Couldn’t save your website chat." };
  }
}
