import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { titleFrom } from "@/lib/conversations";
import { appendMessages } from "@/lib/data/conversations";
import { runCustomerTurn } from "./agent-turn";
import { findConnection, firstDelivery, markConnectionError, type ConnectionKind } from "./connections";
import { sendDirectMessage, type MetaConfig, type MetaInbound } from "./meta";
import { notifyOwner } from "./notify";
import { draftPublicReply } from "./reputation";

export type MetaCredentials = { pageToken?: string; token?: string };

const kindFor = {
  messenger: "facebook_page",
  instagram: "instagram",
  whatsapp: "whatsapp",
  facebook_comment: "facebook_page",
  facebook_recommendation: "facebook_page",
  instagram_comment: "instagram",
} as const satisfies Record<string, ConnectionKind>;

const channelName = { messenger: "Messenger", instagram: "Instagram", whatsapp: "WhatsApp" } as const;

export function tokenFor(credentials: MetaCredentials | null) {
  return credentials?.pageToken ?? credentials?.token ?? null;
}

// Finds the conversation for this person on this account, or starts one.
async function threadFor(
  admin: SupabaseClient,
  tenantId: string,
  connectionId: string,
  event: Extract<MetaInbound, { type: "message" }>,
) {
  const find = () =>
    admin
      .from("hc_conversations")
      .select("id, mode")
      .eq("tenant_id", tenantId)
      .eq("connection_id", connectionId)
      .eq("external_thread_id", event.threadId)
      .maybeSingle();
  const { data: existing } = await find();
  if (existing) return { id: existing.id as string, mode: existing.mode as "ai" | "human", created: false };
  const { data: contact } = await admin
    .from("hc_contacts")
    .insert({ tenant_id: tenantId, display_name: (event.senderName ?? `${channelName[event.channel]} customer`).slice(0, 120), ...(event.channel === "whatsapp" ? { phone: `+${event.threadId}`.slice(0, 40) } : {}) })
    .select("id")
    .single();
  const { data, error } = await admin
    .from("hc_conversations")
    .insert({
      tenant_id: tenantId,
      channel: event.channel,
      title: titleFrom(event.text),
      connection_id: connectionId,
      external_thread_id: event.threadId,
      contact_id: contact?.id ?? null,
    })
    .select("id")
    .single();
  if (error?.code === "23505") {
    const { data: raced } = await find();
    if (raced) return { id: raced.id as string, mode: raced.mode as "ai" | "human", created: false };
  }
  if (error || !data) throw new Error("Couldn’t start the conversation.");
  return { id: data.id as string, mode: "ai" as const, created: true };
}

async function handleMessage(admin: SupabaseClient, config: MetaConfig, event: Extract<MetaInbound, { type: "message" }>) {
  const connection = await findConnection<MetaCredentials>(admin, kindFor[event.channel], event.accountId);
  if (!connection) return;
  if (!(await firstDelivery(admin, "meta", `${event.channel}:${event.messageId}`))) return;
  const tenantId = connection.tenantId;
  const thread = await threadFor(admin, tenantId, connection.id, event);
  await appendMessages(admin, { tenantId }, thread.id, [
    { id: crypto.randomUUID(), role: "customer", text: event.text.slice(0, 4000), engine: thread.mode === "human" ? "human" : undefined },
  ]);
  if (thread.created)
    await notifyOwner(admin, tenantId, { kind: "new_chat", conversationId: thread.id, firstMessage: event.text });
  // A person took over: the message waits for them in Conversations.
  if (thread.mode === "human") return;

  const turn = await runCustomerTurn(admin, { tenantId, conversationId: thread.id, question: event.text });
  const token = tokenFor(connection.credentials);
  if (!token) return markConnectionError(admin, tenantId, connection.id, "Missing access token. Reconnect this account.");
  try {
    await sendDirectMessage(config, event.channel, { externalId: connection.externalId, token, recipient: event.threadId }, turn.reply);
  } catch (error) {
    await markConnectionError(admin, tenantId, connection.id, error instanceof Error ? error.message : "Sending failed.");
  }
}

async function handlePublic(admin: SupabaseClient, event: Extract<MetaInbound, { type: "public" }>) {
  const connection = await findConnection<MetaCredentials>(admin, kindFor[event.kind], event.accountId);
  if (!connection) return;
  const tenantId = connection.tenantId;
  const { data } = await admin
    .from("hc_public_replies")
    .upsert(
      {
        tenant_id: tenantId,
        connection_id: connection.id,
        kind: event.kind,
        external_id: event.externalId,
        parent_external_id: event.parentId ?? null,
        author_name: event.authorName?.slice(0, 120) ?? null,
        body: event.text.slice(0, 8000),
      },
      { onConflict: "connection_id,external_id", ignoreDuplicates: true },
    )
    .select("id");
  const id = data?.[0]?.id as string | undefined;
  if (!id) return; // already handled
  const { draft, skip } = await draftPublicReply(admin, tenantId, {
    kind: event.kind,
    authorName: event.authorName,
    body: event.text,
    positive: event.positive,
  });
  await admin
    .from("hc_public_replies")
    .update(skip ? { status: "skipped" } : draft ? { status: "drafted", draft } : {})
    .eq("tenant_id", tenantId)
    .eq("id", id);
  if (!skip)
    await notifyOwner(admin, tenantId, {
      kind: "public_reply",
      network: event.kind === "instagram_comment" ? "Instagram" : "Facebook",
      author: event.authorName ?? "Someone",
      text: event.text,
    });
}

// Handles one webhook event. Errors are logged so one bad event never blocks
// the rest of the delivery.
export async function handleMetaEvent(admin: SupabaseClient, config: MetaConfig, event: MetaInbound) {
  try {
    if (event.type === "message") await handleMessage(admin, config, event);
    else await handlePublic(admin, event);
  } catch (error) {
    console.error("[meta] event failed:", error instanceof Error ? error.message : "unknown");
  }
}
