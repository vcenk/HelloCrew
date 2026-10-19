import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSiteUrl } from "@/lib/supabase/config";

export type OwnerEvent =
  | { kind: "approval"; conversationId: string; summary: string }
  | { kind: "handoff"; conversationId: string; title: string }
  | {
      kind: "lead";
      conversationId: string | null;
      name: string;
      contact: string;
      interest: string;
    }
  | { kind: "new_chat"; conversationId: string; firstMessage: string }
  | { kind: "public_reply"; network: string; author: string; text: string }
  | { kind: "test" };

type Settings = {
  email: string | null;
  on_approval: boolean;
  on_handoff: boolean;
  on_lead: boolean;
  on_new_chat: boolean;
};

const defaults: Settings = {
  email: null,
  on_approval: true,
  on_handoff: true,
  on_lead: true,
  on_new_chat: false,
};

export function emailConfigured(
  env: Record<string, string | undefined> = process.env,
) {
  return Boolean(env.RESEND_API_KEY?.trim());
}

function escapeHtml(text: string) {
  return text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}

export function describeEvent(event: OwnerEvent, site: string) {
  const link = (id: string | null) =>
    id ? `${site}/app/conversations?c=${id}` : `${site}/app`;
  switch (event.kind) {
    case "approval":
      return {
        subject: `Booking request: ${event.summary}`,
        line: `A customer asked to book ${event.summary}. It waits for your OK.`,
        cta: "Review the request",
        url: `${site}/app`,
      };
    case "handoff":
      return {
        subject: "A customer asked for a person",
        line: `“${event.title}” needs a reply from you.`,
        cta: "Open the chat",
        url: link(event.conversationId),
      };
    case "lead":
      return {
        subject: `New lead: ${event.name}`,
        line: `${event.name} (${event.contact}) wants: ${event.interest}`,
        cta: "See the lead",
        url: link(event.conversationId),
      };
    case "new_chat":
      return {
        subject: "New website chat",
        line: `A visitor wrote: “${event.firstMessage.slice(0, 200)}”`,
        cta: "Open the chat",
        url: link(event.conversationId),
      };
    case "public_reply":
      return {
        subject: `New ${event.network} comment to answer`,
        line: `${event.author} wrote: “${event.text.slice(0, 200)}”. A reply is ready for your OK.`,
        cta: "Review the reply",
        url: `${site}/app`,
      };
    case "test":
      return {
        subject: "HelloCrew alerts are working",
        line: "This is a test. You’ll get emails like this when your crew needs you.",
        cta: "Open HelloCrew",
        url: `${site}/app`,
      };
  }
}

async function loadSettings(
  admin: SupabaseClient,
  tenantId: string,
): Promise<Settings> {
  const { data } = await admin
    .from("hc_notification_settings")
    .select("email, on_approval, on_handoff, on_lead, on_new_chat")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return (data as Settings | null) ?? defaults;
}

async function ownerEmail(admin: SupabaseClient, tenantId: string) {
  const { data } = await admin
    .from("hc_memberships")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("role", "owner")
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data?.user_id) return null;
  const { data: user } = await admin.auth.admin.getUserById(
    data.user_id as string,
  );
  return user?.user?.email ?? null;
}

// Emails the owner about something that needs them. Best effort: a failure
// is logged and never affects the customer's chat.
export async function notifyOwner(
  admin: SupabaseClient,
  tenantId: string,
  event: OwnerEvent,
): Promise<boolean> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return false;
  try {
    const settings = await loadSettings(admin, tenantId);
    const wanted =
      event.kind === "test" ||
      ((event.kind === "approval" || event.kind === "public_reply") && settings.on_approval) ||
      (event.kind === "handoff" && settings.on_handoff) ||
      (event.kind === "lead" && settings.on_lead) ||
      (event.kind === "new_chat" && settings.on_new_chat);
    if (!wanted) return false;
    const to = settings.email ?? (await ownerEmail(admin, tenantId));
    if (!to) return false;
    const site = getSiteUrl();
    const { subject, line, cta, url } = describeEvent(event, site);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        from:
          process.env.NOTIFY_FROM?.trim() ||
          "HelloCrew <onboarding@resend.dev>",
        to: [to],
        subject: subject.slice(0, 150),
        text: `${line}\n\n${cta}: ${url}\n\nYou can change alerts in HelloCrew → Settings.`,
        html: `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#15201a">
<p>${escapeHtml(line)}</p>
<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#1f5a44;color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none">${escapeHtml(cta)}</a></p>
<p style="color:#75817a;font-size:12px">You can change alerts in HelloCrew → Settings.</p></div>`,
      }),
    });
    if (!response.ok) {
      console.error("[notify] email failed:", response.status);
      return false;
    }
    return true;
  } catch (error) {
    console.error(
      "[notify] email failed:",
      error instanceof Error ? error.message : "unknown",
    );
    return false;
  }
}
