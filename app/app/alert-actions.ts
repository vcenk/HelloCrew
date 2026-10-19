"use server";

import { z } from "zod";

import { getWorkspaceContext } from "@/lib/data/workspace";
import { emailConfigured, notifyOwner } from "@/lib/server/notify";
import { rateLimit } from "@/lib/server/rate-limit";
import { widgetAdminClient } from "@/lib/server/widget-installations";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export type AlertSettings = {
  email: string;
  onApproval: boolean;
  onHandoff: boolean;
  onLead: boolean;
  onNewChat: boolean;
};

type Failure = { ok: false; error: string };

async function session() {
  if (!isSupabaseConfigured()) return null;
  const db = await createClient();
  const workspace = await getWorkspaceContext(db);
  return workspace ? { db, workspace } : null;
}

export async function getAlertSettings(): Promise<
  | {
      ok: true;
      settings: AlertSettings;
      accountEmail: string | null;
      emailReady: boolean;
    }
  | Failure
> {
  const s = await session();
  if (!s) return { ok: false, error: "Sign in to set up alerts." };
  const { data } = await s.db
    .from("hc_notification_settings")
    .select("email, on_approval, on_handoff, on_lead, on_new_chat")
    .eq("tenant_id", s.workspace.tenantId)
    .maybeSingle();
  return {
    ok: true,
    accountEmail: s.workspace.email,
    emailReady: emailConfigured(),
    settings: {
      email: (data?.email as string | null) ?? "",
      onApproval: data?.on_approval ?? true,
      onHandoff: data?.on_handoff ?? true,
      onLead: data?.on_lead ?? true,
      onNewChat: data?.on_new_chat ?? false,
    },
  };
}

const settingsSchema = z
  .object({
    email: z.union([z.literal(""), z.string().trim().email().max(254)]),
    onApproval: z.boolean(),
    onHandoff: z.boolean(),
    onLead: z.boolean(),
    onNewChat: z.boolean(),
  })
  .strict();

export async function saveAlertSettings(
  input: AlertSettings,
): Promise<{ ok: true } | Failure> {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the email address." };
  const s = await session();
  if (!s) return { ok: false, error: "Sign in to set up alerts." };
  if (s.workspace.role === "viewer")
    return { ok: false, error: "Only owners and operators can change alerts." };
  const { error } = await s.db.from("hc_notification_settings").upsert({
    tenant_id: s.workspace.tenantId,
    email: parsed.data.email || null,
    on_approval: parsed.data.onApproval,
    on_handoff: parsed.data.onHandoff,
    on_lead: parsed.data.onLead,
    on_new_chat: parsed.data.onNewChat,
    updated_by: s.workspace.userId,
  });
  if (error) return { ok: false, error: "Couldn’t save your alert settings." };
  return { ok: true };
}

export async function sendTestAlert(): Promise<{ ok: true } | Failure> {
  const s = await session();
  if (!s) return { ok: false, error: "Sign in first." };
  if (!emailConfigured())
    return {
      ok: false,
      error: "Email sending isn’t set up on the server yet.",
    };
  if (!rateLimit(`test-alert:${s.workspace.tenantId}`, 3, 10 * 60_000).ok)
    return {
      ok: false,
      error: "Wait a few minutes before sending another test.",
    };
  const admin = widgetAdminClient();
  if (!admin)
    return { ok: false, error: "This server isn’t fully configured." };
  const sent = await notifyOwner(admin, s.workspace.tenantId, { kind: "test" });
  return sent
    ? { ok: true }
    : {
        ok: false,
        error:
          "The test email didn’t send. Check the email settings on the server.",
      };
}
