"use server";

import { z } from "zod";

import {
  decisionReply,
  storedMessageSchema,
  type NeedsYou,
  type StoredApproval,
  type StoredMessage,
  type StoredMessageInput,
  type ThreadSummary,
} from "@/lib/conversations";
import {
  appendMessages,
  createThread,
  deleteThread,
  getThread,
  listThreads,
  loadNeedsYou,
  setLeadStatus,
  setThreadState,
} from "@/lib/data/conversations";
import { getWorkspaceContext, type WorkspaceContext } from "@/lib/data/workspace";
import { deliverToCustomer } from "@/lib/server/deliver";
import {
  calendarProposalFromApproval,
  customerReplyFor,
  ownerNoteFor,
} from "@/lib/calendar/approval";
import { confirmBooking, type ConfirmOutcome } from "@/lib/calendar/confirm";
import { calendarForTenant } from "@/lib/calendar/for-turn";
import { widgetAdminClient } from "@/lib/server/widget-installations";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

type Failure = { ok: false; reason: "signed_out" | "forbidden" | "invalid" | "not_found" | "error"; error: string };
type Result<T> = ({ ok: true } & T) | Failure;

const idSchema = z.string().uuid();

async function session(write: boolean) {
  if (!isSupabaseConfigured()) return null;
  const db = await createClient();
  const workspace = await getWorkspaceContext(db);
  if (!workspace) return null;
  if (write && workspace.role === "viewer") return { db, workspace, forbidden: true as const };
  return { db, workspace, forbidden: false as const };
}

function failure(reason: Failure["reason"], error: string): Failure {
  return { ok: false, reason, error };
}

async function run<T>(
  write: boolean,
  body: (db: Awaited<ReturnType<typeof createClient>>, workspace: WorkspaceContext) => Promise<Result<T>>,
): Promise<Result<T>> {
  try {
    const s = await session(write);
    if (!s) return failure("signed_out", "Sign in to save conversations.");
    if (s.forbidden) return failure("forbidden", "Viewers can’t change conversations.");
    return await body(s.db, s.workspace);
  } catch (error) {
    return failure("error", error instanceof Error ? error.message : "Something went wrong.");
  }
}

export async function listConversations(): Promise<Result<{ threads: ThreadSummary[] }>> {
  return run(false, async (db, ws) => ({ ok: true, threads: await listThreads(db, ws) }));
}

export async function openConversation(
  id: string,
): Promise<Result<{ thread: ThreadSummary; messages: StoredMessage[]; approvals: StoredApproval[] }>> {
  if (!idSchema.safeParse(id).success) return failure("invalid", "Unknown conversation.");
  return run(false, async (db, ws) => {
    const found = await getThread(db, ws, id);
    if (!found) return failure("not_found", "That conversation no longer exists.");
    return { ok: true, ...found };
  });
}

const saveSchema = z
  .object({
    conversationId: idSchema,
    messages: z.array(storedMessageSchema).min(1).max(4),
  })
  .strict();

// Saves turns that happened in the browser (practice replies, the owner
// playing the customer). Creates the test conversation on first use.
export async function saveMessages(input: {
  conversationId: string;
  messages: StoredMessageInput[];
}): Promise<Result<{ thread: ThreadSummary }>> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return failure("invalid", "That message couldn’t be saved.");
  return run(true, async (db, ws) => {
    const { conversationId, messages } = parsed.data;
    const existing = await getThread(db, ws, conversationId);
    if (existing && existing.thread.channel !== "test" && messages.some((m) => m.role !== "owner"))
      return failure("forbidden", "Only your own replies can be added to a customer chat.");
    if (!existing) {
      const first = messages.find((m) => m.role === "customer") ?? messages[0];
      await createThread(db, ws, { id: conversationId, firstMessage: first.text });
    }
    await appendMessages(db, ws, conversationId, messages);
    const updated = await getThread(db, ws, conversationId);
    if (!updated) return failure("not_found", "That conversation no longer exists.");
    return { ok: true, thread: updated.thread };
  });
}

const stateSchema = z
  .object({
    conversationId: idSchema,
    action: z.enum(["take_over", "hand_back", "close", "reopen"]),
  })
  .strict();

export async function updateConversation(input: {
  conversationId: string;
  action: "take_over" | "hand_back" | "close" | "reopen";
}): Promise<Result<{ thread: ThreadSummary }>> {
  const parsed = stateSchema.safeParse(input);
  if (!parsed.success) return failure("invalid", "Unknown action.");
  return run(true, async (db, ws) => {
    const { conversationId, action } = parsed.data;
    const current = await getThread(db, ws, conversationId);
    if (!current) return failure("not_found", "That conversation no longer exists.");
    const pending = current.approvals.some((a) => a.status === "pending");
    const patch =
      action === "take_over"
        ? { mode: "human" as const, status: "handoff" as const }
        : action === "hand_back"
          ? { mode: "ai" as const, status: pending ? ("waiting" as const) : ("open" as const) }
          : action === "close"
            ? { status: "closed" as const }
            : { status: pending ? ("waiting" as const) : current.thread.mode === "human" ? ("handoff" as const) : ("open" as const) };
    return { ok: true, thread: await setThreadState(db, ws, conversationId, patch) };
  });
}

export async function removeConversation(id: string): Promise<Result<object>> {
  if (!idSchema.safeParse(id).success) return failure("invalid", "Unknown conversation.");
  return run(true, async (db, ws) => {
    await deleteThread(db, ws, id);
    return { ok: true };
  });
}

const decisionSchema = z
  .object({ approvalId: idSchema, decision: z.enum(["approved", "rejected"]) })
  .strict();

export async function decideApproval(input: {
  approvalId: string;
  decision: "approved" | "rejected";
}): Promise<
  Result<{
    message: StoredMessage | null;
    deliveryError?: string;
    /** Said to the owner when approving did not end in a booking. */
    bookingNote?: string;
  }>
> {
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) return failure("invalid", "Unknown approval.");
  return run(true, async (db, ws) => {
    const { approvalId, decision } = parsed.data;
    const admin = widgetAdminClient();

    // Read before deciding: a calendar booking has to be written before the
    // customer is told anything, so that what they are told is true.
    const { data: approval } = await db
      .from("hc_approvals")
      .select("conversation_id, details, status")
      .eq("tenant_id", ws.tenantId)
      .eq("id", approvalId)
      .maybeSingle();

    const proposal =
      decision === "approved" && approval?.status === "pending"
        ? calendarProposalFromApproval(approvalId, approval.details)
        : null;

    let outcome: ConfirmOutcome | null = null;
    if (proposal) {
      const calendar = admin
        ? await calendarForTenant(admin, ws.tenantId)
        : null;
      // Writing is idempotent on the proposal's key, so the narrow race with
      // another operator deciding at the same moment cannot double-book.
      outcome = calendar
        ? await confirmBooking({ ...calendar, proposal })
        : {
            status: "failed",
            reason: "No calendar is connected to write it to.",
          };
    }

    const { data, error } = await db.rpc("hc_decide_approval", {
      p_approval_id: approvalId,
      p_decision: decision,
      p_reply:
        outcome && proposal
          ? customerReplyFor(outcome, proposal)
          : decisionReply[decision],
    });
    if (error) return failure(error.code === "P0002" ? "not_found" : "error", "That approval couldn’t be updated.");
    if (!data) return { ok: true, message: null }; // already decided or expired
    const row = data as { id: string; body: string; createdAt: string };
    // The customer may be on Messenger, Instagram or WhatsApp: send them the outcome.
    let deliveryError: string | undefined;
    if (approval && admin) {
      const result = await deliverToCustomer(admin, ws.tenantId, approval.conversation_id as string, row.body);
      if (result.delivered === false) deliveryError = result.reason;
    }
    const bookingNote = outcome ? ownerNoteFor(outcome) : undefined;
    return {
      ok: true,
      ...(deliveryError ? { deliveryError } : {}),
      ...(bookingNote ? { bookingNote } : {}),
      message: {
        id: row.id,
        role: "assistant",
        text: row.body,
        at: Date.parse(row.createdAt),
        engine: "live",
        meta: { decision, approvalId },
      },
    };
  });
}

export async function loadNeedsYouSummary(): Promise<Result<{ needsYou: NeedsYou }>> {
  return run(false, async (db, ws) => ({ ok: true, needsYou: await loadNeedsYou(db, ws) }));
}

const leadSchema = z
  .object({ leadId: idSchema, status: z.enum(["new", "contacted", "won", "lost"]) })
  .strict();

export async function updateLead(input: {
  leadId: string;
  status: "new" | "contacted" | "won" | "lost";
}): Promise<Result<object>> {
  const parsed = leadSchema.safeParse(input);
  if (!parsed.success) return failure("invalid", "Unknown lead.");
  return run(true, async (db, ws) => {
    await setLeadStatus(db, ws, parsed.data.leadId, parsed.data.status);
    return { ok: true };
  });
}
