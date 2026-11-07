import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { titleFrom } from "@/lib/conversations";
import { appendMessages } from "@/lib/data/conversations";
import { runCustomerTurn } from "./agent-turn";
import {
  claimEvent,
  completeEvent,
  failEvent,
  findConnection,
  markConnectionError,
  receiveEvent,
  stuckEvents,
  type ConnectionKind,
} from "./connections";
import { sendDirectMessage, type MetaConfig, type MetaInbound } from "./meta";
import { notifyOwner } from "./notify";
import { saveDraftOrPost } from "./public-replies";
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
  const row = { id, connection_id: connection.id, kind: event.kind, external_id: event.externalId };
  const { draft, skip, tone } = await draftPublicReply(admin, tenantId, {
    kind: event.kind,
    authorName: event.authorName,
    body: event.text,
    positive: event.positive,
  });
  // A SKIP from the model is only a suggestion: the item stays visible (without
  // a draft) so the owner decides. Nothing disappears silently.
  const posted = draft ? await saveDraftOrPost(admin, tenantId, row, { text: draft, tone, positive: event.positive }) : false;
  if (!skip && !posted)
    await notifyOwner(admin, tenantId, {
      kind: "public_reply",
      network: event.kind === "instagram_comment" ? "Instagram" : "Facebook",
      author: event.authorName ?? "Someone",
      text: event.text,
    });
}

/** The provider's own id for this delivery, stable across its retries. */
function eventKey(event: MetaInbound) {
  return event.type === "message"
    ? `${event.channel}:${event.messageId}`
    : `${event.kind}:${event.externalId}`;
}

/**
 * Write the delivery down before the route answers 200.
 *
 * Stores the parsed event rather than the raw body: the raw body carries
 * provider metadata we have no use for, and the parsed form is the smallest
 * thing the sweeper can replay.
 */
export async function recordArrival(admin: SupabaseClient, event: MetaInbound) {
  await receiveEvent(admin, "meta", eventKey(event), event);
}

/**
 * Finish deliveries that were accepted and never completed.
 *
 * The gap this closes: the route answers 200 immediately, so Meta will not
 * redeliver, and `after` can be cut off by the invocation's time limit. With
 * no sweeper, work interrupted halfway would stay unfinished forever. Only
 * events whose lease has expired are picked up, so a turn still running is
 * never duplicated.
 */
export async function retryStuckMetaEvents(
  admin: SupabaseClient,
  config: MetaConfig,
  limit = 20,
): Promise<{ found: number; finished: number }> {
  const stuck = await stuckEvents(admin, "meta", limit);
  let finished = 0;
  for (const row of stuck) {
    const event = row.payload as MetaInbound | null;
    if (!event || typeof event !== "object" || !("type" in event)) {
      // Nothing replayable. Park it rather than trying again every hour.
      await failEvent(admin, "meta", row.eventId, "unreadable stored event", false);
      continue;
    }
    if ((await handleMetaEvent(admin, config, event)) === "completed") finished += 1;
  }
  return { found: stuck.length, finished };
}

/**
 * Handles one webhook event, exactly once, and lets a failure be retried.
 *
 * The claim wraps the whole unit of work rather than preceding it. Marking
 * the event before storing the message, running the model and delivering the
 * reply meant a later failure was permanent: Meta's retry carried the same
 * id, the old insert conflicted, and the customer's message was dropped with
 * nothing but a log line.
 *
 * One bad event still must not block the rest of the batch, so the error is
 * swallowed here — but only after the row is marked retryable, which is what
 * makes the provider's next delivery do something.
 */
export type EventOutcome = "completed" | "skipped" | "failed";

export async function handleMetaEvent(
  admin: SupabaseClient,
  config: MetaConfig,
  event: MetaInbound,
): Promise<EventOutcome> {
  const key = eventKey(event);
  let claim: Awaited<ReturnType<typeof claimEvent>>;
  try {
    claim = await claimEvent(admin, "meta", key);
  } catch (error) {
    // The ledger itself is unreachable. Doing the work anyway risks a
    // duplicate reply to a real customer, which is worse than leaving the
    // event for the sweeper.
    console.error("[meta] could not claim event:", error instanceof Error ? error.message : "unknown");
    return "skipped";
  }
  // 'completed' means someone already did it; 'locked' means someone is
  // doing it now. Neither is this worker's to touch.
  if (claim !== "claimed") return "skipped";

  try {
    if (event.type === "message") await handleMessage(admin, config, event);
    else await handlePublic(admin, event);
    await completeEvent(admin, "meta", key);
    return "completed";
  } catch (error) {
    // Only the step name and the provider's own wording. Never the message.
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("[meta] event failed:", reason);
    await failEvent(admin, "meta", key, reason, true);
    return "failed";
  }
}
