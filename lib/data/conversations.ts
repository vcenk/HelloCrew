import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  messageMetaSchema,
  titleFrom,
  UNANSWERED_SOURCE,
  type MessageMeta,
  type NeedsYou,
  type StoredApproval,
  type StoredMessage,
  type ThreadStatus,
  type ThreadSummary,
} from "@/lib/conversations";
import type { WorkspaceContext } from "./workspace";

// Writes and reads that only need the tenant (server-side callers pass the
// tenant they already verified).
type Tenant = Pick<WorkspaceContext, "tenantId">;

type Row = Record<string, unknown>;

const threadColumns =
  "id, channel, title, status, mode, last_message_at, last_message_preview, message_count";

function toThread(row: Row): ThreadSummary {
  return {
    id: row.id as string,
    channel: row.channel as ThreadSummary["channel"],
    title: row.title as string,
    status: row.status as ThreadStatus,
    mode: row.mode as ThreadSummary["mode"],
    lastMessageAt: row.last_message_at as string,
    preview: row.last_message_preview as string,
    messageCount: Number(row.message_count),
  };
}

function toMessage(row: Row): StoredMessage {
  const meta = messageMetaSchema.safeParse(row.meta);
  return {
    id: row.id as string,
    role: row.role as StoredMessage["role"],
    text: row.body as string,
    at: Date.parse(row.created_at as string),
    engine: (row.engine as StoredMessage["engine"]) ?? undefined,
    meta: meta.success ? meta.data : {},
  };
}

function toApproval(row: Row): StoredApproval {
  return {
    id: row.id as string,
    conversationId: row.conversation_id as string,
    messageId: (row.message_id as string | null) ?? null,
    summary: row.summary as string,
    status: row.status as StoredApproval["status"],
    createdAt: row.created_at as string,
  };
}

export async function listThreads(
  db: SupabaseClient,
  workspace: WorkspaceContext,
  limit = 50,
): Promise<ThreadSummary[]> {
  const { data, error } = await db
    .from("hc_conversations")
    .select(threadColumns)
    .eq("tenant_id", workspace.tenantId)
    .order("last_message_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error("Could not load conversations.");
  return (data ?? []).map(toThread);
}

export async function getThread(
  db: SupabaseClient,
  workspace: WorkspaceContext,
  id: string,
) {
  const [thread, messages, approvals] = await Promise.all([
    db
      .from("hc_conversations")
      .select(threadColumns)
      .eq("tenant_id", workspace.tenantId)
      .eq("id", id)
      .maybeSingle(),
    db
      .from("hc_messages")
      .select("id, role, body, engine, meta, created_at")
      .eq("tenant_id", workspace.tenantId)
      .eq("conversation_id", id)
      .order("created_at", { ascending: true })
      .limit(500),
    db
      .from("hc_approvals")
      .select("id, conversation_id, message_id, summary, status, created_at")
      .eq("tenant_id", workspace.tenantId)
      .eq("conversation_id", id),
  ]);
  if (thread.error || messages.error || approvals.error)
    throw new Error("Could not load the conversation.");
  if (!thread.data) return null;
  return {
    thread: toThread(thread.data),
    messages: (messages.data ?? []).map(toMessage),
    approvals: (approvals.data ?? []).map(toApproval),
  };
}

export async function createThread(
  db: SupabaseClient,
  workspace: WorkspaceContext,
  input: { id: string; firstMessage: string },
) {
  const { data, error } = await db
    .from("hc_conversations")
    .insert({
      tenant_id: workspace.tenantId,
      id: input.id,
      channel: "test",
      title: titleFrom(input.firstMessage),
      created_by: workspace.userId,
    })
    .select(threadColumns)
    .single();
  if (error) {
    // Already created (a retried request): return the existing one.
    if (error.code === "23505") {
      const existing = await getThread(db, workspace, input.id);
      if (existing) return existing.thread;
    }
    throw new Error("Could not start the conversation.");
  }
  return toThread(data);
}

export type NewMessage = {
  id: string;
  role: StoredMessage["role"];
  text: string;
  engine?: StoredMessage["engine"];
  meta?: MessageMeta;
};

// Inserts messages in order. Re-sending a message id is a no-op, so the
// dashboard can safely retry after a network error.
export async function appendMessages(
  db: SupabaseClient,
  workspace: Tenant,
  conversationId: string,
  messages: NewMessage[],
) {
  for (const message of messages) {
    const { error } = await db.from("hc_messages").insert({
      tenant_id: workspace.tenantId,
      id: message.id,
      conversation_id: conversationId,
      role: message.role,
      body: message.text.slice(0, 4000),
      engine: message.engine ?? null,
      meta: message.meta ?? {},
    });
    if (error && error.code !== "23505")
      throw new Error(
        error.code === "54000"
          ? "This conversation is full. Start a new one."
          : "Could not save the message.",
      );
  }
}

export async function historyForModel(
  db: SupabaseClient,
  workspace: Tenant,
  conversationId: string,
  max: number,
) {
  const { data, error } = await db
    .from("hc_messages")
    .select("role, body, created_at")
    .eq("tenant_id", workspace.tenantId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(max);
  if (error) throw new Error("Could not load the conversation.");
  // Owner replies are shown to the model as the business speaking.
  const turns = (data ?? [])
    .reverse()
    .map((row) => ({
      role: row.role === "customer" ? ("user" as const) : ("assistant" as const),
      content: String(row.body).slice(0, 1500),
    }));
  while (turns.length > 1 && turns[0].role !== "user") turns.shift();
  return turns;
}

export async function setThreadState(
  db: SupabaseClient,
  workspace: WorkspaceContext,
  id: string,
  patch: Partial<{ status: ThreadStatus; mode: "ai" | "human"; title: string }>,
) {
  const { data, error } = await db
    .from("hc_conversations")
    .update(patch)
    .eq("tenant_id", workspace.tenantId)
    .eq("id", id)
    .select(threadColumns)
    .maybeSingle();
  if (error || !data) throw new Error("Could not update the conversation.");
  return toThread(data);
}

export async function deleteThread(
  db: SupabaseClient,
  workspace: WorkspaceContext,
  id: string,
) {
  const { error } = await db
    .from("hc_conversations")
    .delete()
    .eq("tenant_id", workspace.tenantId)
    .eq("id", id);
  if (error) throw new Error("Could not delete the conversation.");
}

// Everything on Today that needs the owner, across all conversations.
export async function loadNeedsYou(
  db: SupabaseClient,
  workspace: WorkspaceContext,
): Promise<NeedsYou> {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const [approvals, unanswered, handoffs] = await Promise.all([
    db
      .from("hc_approvals")
      .select("id, conversation_id, message_id, summary, status, created_at")
      .eq("tenant_id", workspace.tenantId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(20),
    db
      .from("hc_messages")
      .select("conversation_id, meta, created_at")
      .eq("tenant_id", workspace.tenantId)
      .eq("role", "assistant")
      .eq("meta->>unanswered", "true")
      .gt("created_at", since)
      .order("created_at", { ascending: false })
      .limit(40),
    db
      .from("hc_conversations")
      .select("id, title, last_message_at")
      .eq("tenant_id", workspace.tenantId)
      .eq("status", "handoff")
      .order("last_message_at", { ascending: false })
      .limit(10),
  ]);
  if (approvals.error || unanswered.error || handoffs.error)
    throw new Error("Could not load what needs you.");

  const seen = new Set<string>();
  const questions: NeedsYou["unanswered"] = [];
  for (const row of unanswered.data ?? []) {
    const question = (row.meta as MessageMeta | null)?.question?.trim();
    if (!question || seen.has(question.toLowerCase())) continue;
    seen.add(question.toLowerCase());
    questions.push({ question, conversationId: row.conversation_id as string, at: row.created_at as string });
  }

  const pending = (approvals.data ?? []).map(toApproval);
  const titles = new Map<string, string>();
  const ids = [...new Set(pending.map((a) => a.conversationId))];
  if (ids.length > 0) {
    const { data } = await db
      .from("hc_conversations")
      .select("id, title")
      .eq("tenant_id", workspace.tenantId)
      .in("id", ids);
    for (const row of data ?? []) titles.set(row.id as string, row.title as string);
  }

  return {
    approvals: pending.map((a) => ({ ...a, conversationTitle: titles.get(a.conversationId) ?? "Conversation" })),
    unanswered: questions.slice(0, 10),
    handoffs: (handoffs.data ?? []).map((row) => ({
      conversationId: row.id as string,
      title: row.title as string,
      at: row.last_message_at as string,
    })),
  };
}

export { UNANSWERED_SOURCE };
