"use server";

import { randomInt } from "node:crypto";

import { z } from "zod";

import { appendMessages } from "@/lib/data/conversations";
import { getWorkspaceContext } from "@/lib/data/workspace";
import { ConnectionTakenError, saveConnection } from "@/lib/server/connections";
import { googleConfigured } from "@/lib/server/google";
import {
  checkWhatsAppNumber,
  MetaApiError,
  exchangeEmbeddedSignupCode,
  readMetaConfig,
  registerWhatsAppNumber,
  subscribeWhatsAppAccount,
  whatsAppTokenInfo,
} from "@/lib/server/meta";
import { secretsConfigured } from "@/lib/server/secrets";
import { deliverToCustomer } from "@/lib/server/deliver";
import { postReply } from "@/lib/server/public-replies";
import { widgetAdminClient } from "@/lib/server/widget-installations";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export type ChannelConnection = {
  id: string;
  provider: "meta" | "google";
  kind:
    | "facebook_page"
    | "instagram"
    | "whatsapp"
    | "google_location"
    | "google_calendar";
  externalId: string;
  displayName: string;
  status: "connected" | "error" | "disconnected";
  lastError: string | null;
  createdAt: string;
};

export type PublicReplyItem = {
  id: string;
  connectionId: string;
  kind: "facebook_comment" | "instagram_comment" | "google_review" | "facebook_recommendation";
  authorName: string | null;
  body: string;
  rating: number | null;
  draft: string | null;
  status: "new" | "drafted" | "posted" | "skipped" | "failed";
  error: string | null;
  receivedAt: string;
};

type Failure = { ok: false; error: string };

async function session(write: boolean) {
  if (!isSupabaseConfigured()) return null;
  const db = await createClient();
  const workspace = await getWorkspaceContext(db);
  if (!workspace || (write && workspace.role === "viewer")) return null;
  return { db, workspace };
}

export async function channelSetupStatus() {
  const meta = readMetaConfig();
  return {
    meta: Boolean(meta),
    google: googleConfigured(),
    secrets: secretsConfigured(),
    // Public values the browser needs to open Meta's WhatsApp signup popup.
    whatsappSignup:
      meta?.whatsappConfigId ? { appId: meta.appId, configId: meta.whatsappConfigId, version: meta.version } : null,
  };
}

export async function listConnections(): Promise<{ ok: true; connections: ChannelConnection[] } | Failure> {
  const s = await session(false);
  if (!s) return { ok: false, error: "Sign in to connect accounts." };
  const { data, error } = await s.db
    .from("hc_channel_connections")
    .select("id, provider, kind, external_id, display_name, status, last_error, created_at")
    .eq("tenant_id", s.workspace.tenantId)
    .order("created_at", { ascending: true });
  if (error) return { ok: false, error: "Couldn’t load your connected accounts." };
  return {
    ok: true,
    connections: (data ?? []).map((row) => ({
      id: row.id as string,
      provider: row.provider as ChannelConnection["provider"],
      kind: row.kind as ChannelConnection["kind"],
      externalId: row.external_id as string,
      displayName: row.display_name as string,
      status: row.status as ChannelConnection["status"],
      lastError: (row.last_error as string | null) ?? null,
      createdAt: row.created_at as string,
    })),
  };
}

export async function disconnectConnection(id: string): Promise<{ ok: true } | Failure> {
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Unknown account." };
  const s = await session(true);
  if (!s) return { ok: false, error: "Only owners and operators can disconnect accounts." };
  const { error } = await s.db.from("hc_channel_connections").delete().eq("tenant_id", s.workspace.tenantId).eq("id", id);
  if (error) return { ok: false, error: "Couldn’t disconnect." };
  return { ok: true };
}

// WhatsApp before Meta approves HelloCrew for Embedded Signup: the owner
// pastes the test (or own) number's id and an access token from their Meta app.
const whatsappSchema = z
  .object({
    phoneNumberId: z.string().trim().regex(/^\d{5,30}$/, "The phone number ID is a long number."),
    accessToken: z.string().trim().min(20).max(1000),
  })
  .strict();

export async function connectWhatsAppTest(input: z.input<typeof whatsappSchema>): Promise<{ ok: true } | Failure> {
  const parsed = whatsappSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the values." };
  const config = readMetaConfig();
  const admin = widgetAdminClient();
  if (!config || !admin || !secretsConfigured()) return { ok: false, error: "Meta isn’t set up on the server yet." };
  const s = await session(true);
  if (!s) return { ok: false, error: "Only owners and operators can connect accounts." };
  let number;
  let accounts: string[] = [];
  try {
    number = await checkWhatsAppNumber(config, parsed.data.phoneNumberId, parsed.data.accessToken);
    // Without this subscription Meta never sends incoming messages to HelloCrew.
    const info = await whatsAppTokenInfo(config, parsed.data.accessToken);
    const missing = ["whatsapp_business_messaging", "whatsapp_business_management"].filter((scope) => !info.scopes.includes(scope));
    if (missing.length)
      return { ok: false, error: `This token can’t do everything HelloCrew needs. Generate it again with: ${missing.join(", ")}.` };
    accounts = info.accounts;
    if (!accounts.length) {
      // Fall back to the account saved the last time this number was connected.
      const { data: previous } = await admin
        .from("hc_channel_connections")
        .select("settings")
        .eq("kind", "whatsapp")
        .eq("external_id", parsed.data.phoneNumberId)
        .maybeSingle();
      const saved = (previous?.settings as { whatsappAccounts?: unknown } | null)?.whatsappAccounts;
      accounts = Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : [];
    }
    for (const account of accounts) await subscribeWhatsAppAccount(config, account, parsed.data.accessToken);
  } catch (error) {
    return { ok: false, error: error instanceof MetaApiError ? `Meta said: ${error.message}` : "Couldn’t reach Meta." };
  }
  try {
    await saveConnection(admin, {
      tenantId: s.workspace.tenantId,
      provider: "meta",
      kind: "whatsapp",
      externalId: parsed.data.phoneNumberId,
      displayName: `WhatsApp ${number.display_phone_number ?? parsed.data.phoneNumberId}${number.verified_name ? ` · ${number.verified_name}` : ""}`,
      credentials: { token: parsed.data.accessToken },
      settings: { whatsappAccounts: accounts },
      createdBy: s.workspace.userId,
    });
  } catch (error) {
    return { ok: false, error: error instanceof ConnectionTakenError ? error.message : "Couldn’t save the connection." };
  }
  return { ok: true };
}

// One-click WhatsApp (Meta Embedded Signup): the browser gets a code plus the
// chosen number and WhatsApp account; the server does the rest.
const embeddedSchema = z
  .object({
    code: z.string().trim().min(10).max(2000),
    phoneNumberId: z.string().trim().regex(/^\d{5,30}$/),
    wabaId: z.string().trim().regex(/^\d{5,30}$/),
  })
  .strict();

export async function connectWhatsAppEmbedded(input: z.input<typeof embeddedSchema>): Promise<{ ok: true; warning?: string } | Failure> {
  const parsed = embeddedSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "WhatsApp signup didn’t return a number. Try again." };
  const config = readMetaConfig();
  const admin = widgetAdminClient();
  if (!config || !admin || !secretsConfigured()) return { ok: false, error: "Meta isn’t set up on the server yet." };
  const s = await session(true);
  if (!s) return { ok: false, error: "Only owners and operators can connect accounts." };
  const { code, phoneNumberId, wabaId } = parsed.data;
  let token: string;
  let number;
  let warning: string | undefined;
  const pin = String(randomInt(100000, 1000000));
  try {
    token = await exchangeEmbeddedSignupCode(config, code);
    await subscribeWhatsAppAccount(config, wabaId, token);
    const registration = await registerWhatsAppNumber(config, phoneNumberId, token, pin);
    if (!registration.registered) warning = `Connected, but Meta didn’t register the number yet: ${registration.error}`;
    number = await checkWhatsAppNumber(config, phoneNumberId, token);
  } catch (error) {
    return { ok: false, error: error instanceof MetaApiError ? `Meta said: ${error.message}` : "Couldn’t reach Meta." };
  }
  try {
    await saveConnection(admin, {
      tenantId: s.workspace.tenantId,
      provider: "meta",
      kind: "whatsapp",
      externalId: phoneNumberId,
      displayName: `WhatsApp ${number.display_phone_number ?? phoneNumberId}${number.verified_name ? ` · ${number.verified_name}` : ""}`,
      credentials: { token, pin },
      settings: { whatsappAccounts: [wabaId], onboarding: "embedded_signup" },
      createdBy: s.workspace.userId,
    });
  } catch (error) {
    return { ok: false, error: error instanceof ConnectionTakenError ? error.message : "Couldn’t save the connection." };
  }
  return warning ? { ok: true, warning } : { ok: true };
}

export async function listPublicReplies(): Promise<{ ok: true; items: PublicReplyItem[] } | Failure> {
  const s = await session(false);
  if (!s) return { ok: false, error: "Sign in first." };
  const { data, error } = await s.db
    .from("hc_public_replies")
    .select("id, connection_id, kind, author_name, body, rating, draft, status, error, received_at")
    .eq("tenant_id", s.workspace.tenantId)
    .in("status", ["new", "drafted", "failed"])
    .order("received_at", { ascending: false })
    .limit(30);
  if (error) return { ok: false, error: "Couldn’t load comments and reviews." };
  return {
    ok: true,
    items: (data ?? []).map((row) => ({
      id: row.id as string,
      connectionId: row.connection_id as string,
      kind: row.kind as PublicReplyItem["kind"],
      authorName: (row.author_name as string | null) ?? null,
      body: row.body as string,
      rating: (row.rating as number | null) ?? null,
      draft: (row.draft as string | null) ?? null,
      status: row.status as PublicReplyItem["status"],
      error: (row.error as string | null) ?? null,
      receivedAt: row.received_at as string,
    })),
  };
}

const decideSchema = z
  .object({
    id: z.string().uuid(),
    action: z.enum(["post", "skip"]),
    text: z.string().trim().max(1500).optional(),
  })
  .strict();

// The owner approves (posts) or skips a public reply.
export async function decidePublicReply(input: z.input<typeof decideSchema>): Promise<{ ok: true } | Failure> {
  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the reply." };
  const s = await session(true);
  if (!s) return { ok: false, error: "Only owners and operators can reply." };
  const admin = widgetAdminClient();
  if (!admin) return { ok: false, error: "This server isn’t fully configured." };
  const { data: item } = await s.db
    .from("hc_public_replies")
    .select("id, connection_id, kind, external_id, status")
    .eq("tenant_id", s.workspace.tenantId)
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (!item || item.status === "posted" || item.status === "skipped") return { ok: false, error: "This item was already handled." };

  if (parsed.data.action === "skip") {
    await admin
      .from("hc_public_replies")
      .update({ status: "skipped", decided_by: s.workspace.userId })
      .eq("tenant_id", s.workspace.tenantId)
      .eq("id", item.id as string);
    return { ok: true };
  }
  const text = parsed.data.text?.trim();
  if (!text) return { ok: false, error: "Write a reply first." };
  const result = await postReply(
    admin,
    s.workspace.tenantId,
    {
      id: item.id as string,
      connection_id: item.connection_id as string,
      kind: item.kind as string,
      external_id: item.external_id as string,
    },
    text,
    s.workspace.userId,
  );
  return result.ok ? { ok: true } : { ok: false, error: `Couldn’t post: ${result.error}` };
}

// The owner's reply in a Messenger, Instagram or WhatsApp conversation is
// delivered to the customer, then saved. Platforms only allow free-form
// replies within 24 hours of the customer's last message.
export async function replyOnChannel(input: { conversationId: string; messageId: string; text: string }): Promise<
  { ok: true } | Failure
> {
  const parsed = z
    .object({ conversationId: z.string().uuid(), messageId: z.string().uuid(), text: z.string().trim().min(1).max(4000) })
    .strict()
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the message." };
  const s = await session(true);
  if (!s) return { ok: false, error: "Only owners and operators can reply." };
  const admin = widgetAdminClient();
  if (!admin) return { ok: false, error: "This server isn’t fully configured." };
  const { data: conversation } = await s.db
    .from("hc_conversations")
    .select("id")
    .eq("tenant_id", s.workspace.tenantId)
    .eq("id", parsed.data.conversationId)
    .maybeSingle();
  if (!conversation) return { ok: false, error: "Unknown conversation." };
  const result = await deliverToCustomer(admin, s.workspace.tenantId, conversation.id as string, parsed.data.text);
  if (result.delivered === null) return { ok: false, error: "This isn’t a messaging conversation." };
  if (!result.delivered) return { ok: false, error: `Couldn’t send: ${result.reason}` };
  await appendMessages(s.db, s.workspace, conversation.id as string, [
    { id: parsed.data.messageId, role: "owner", text: parsed.data.text, engine: "human" },
  ]);
  return { ok: true };
}
