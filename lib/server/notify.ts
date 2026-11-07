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

/**
 * Where owner-facing mail for this workspace goes.
 *
 * The configured alert address if there is one, otherwise the owner's
 * sign-in address. Exported so anything else emailing the owner resolves
 * it the same way rather than keeping a second copy of the rule.
 */
export async function ownerAlertAddress(
  admin: SupabaseClient,
  tenantId: string,
): Promise<string | null> {
  const settings = await loadSettings(admin, tenantId);
  return settings.email ?? (await ownerEmail(admin, tenantId));
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

export const DEFAULT_FROM = "HelloCrew <onboarding@resend.dev>";

/**
 * The From line, optionally showing the business rather than HelloCrew.
 *
 * A reminder goes to the client's customer, not to the client. Someone who
 * booked at Northline Studio has never heard of HelloCrew, so a reminder
 * from us reads as spam and the appointment gets missed. The address still
 * has to stay on the one domain verified with the provider — Resend rejects
 * a from address outside it — so only the display name changes.
 *
 * `displayName` arrives from tenant data, which makes it untrusted input on
 * its way into a mail header. Anything that could end the name, start an
 * address or split the header is replaced rather than escaped, and the
 * result is quoted and bounded. A name that sanitizes away to nothing falls
 * back to the configured From instead of sending `"" <addr>`.
 */
export function fromHeader(
  displayName?: string,
  configured = process.env.NOTIFY_FROM?.trim(),
): string {
  const base = configured || DEFAULT_FROM;
  if (!displayName) return base;
  const address = base.match(/<([^>]+)>/)?.[1]?.trim() ?? base;
  const safe = displayName
    // "@" goes too, though it cannot break the header. Without it a crafted
    // name can still render as "Evil attacker@evil.com" in the From line,
    // which is a phishing surface rather than a parsing bug. Real business
    // names do not contain one.
    .replace(/[\r\n"<>,;:\\@]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return safe ? `"${safe}" <${address}>` : base;
}

/**
 * Sends one email, and says whether the provider accepted it.
 *
 * The one place a message leaves HelloCrew, so the timeout, the from
 * address and the failure handling are decided once. Accepted is not
 * delivered, and callers that record anything must record only that it was
 * accepted.
 */
export async function sendEmail(message: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Shown instead of HelloCrew. Use the business the customer booked with. */
  fromName?: string;
}): Promise<boolean> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return false;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        from: fromHeader(message.fromName),
        to: [message.to],
        subject: message.subject.slice(0, 150),
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
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
    return await sendEmail({
      to,
      subject,
      text: `${line}\n\n${cta}: ${url}\n\nYou can change alerts in HelloCrew → Settings.`,
      html: `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#15201a">
<p>${escapeHtml(line)}</p>
<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#1f5a44;color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none">${escapeHtml(cta)}</a></p>
<p style="color:#75817a;font-size:12px">You can change alerts in HelloCrew → Settings.</p></div>`,
    });
  } catch (error) {
    console.error(
      "[notify] email failed:",
      error instanceof Error ? error.message : "unknown",
    );
    return false;
  }
}
