import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { runAgentTurn, MAX_HISTORY_MESSAGES, MAX_MODEL_ROUNDS } from "@/lib/agent/graph";
import type { Lead } from "@/lib/agent/tools";
import { notifyOwner, type OwnerEvent } from "@/lib/server/notify";
import { loadAgentContext } from "@/lib/agent/load";
import { buildSystemPrompt } from "@/lib/agent/prompt";
import type { Activity } from "@/lib/demo";
import { answerFromBusiness } from "@/lib/business";
import { statusAfterTurn, UNANSWERED_SOURCE, type ThreadStatus } from "@/lib/conversations";
import { appendMessages, historyForModel } from "@/lib/data/conversations";
import { businessFromKnowledge } from "@/lib/knowledge";
import { createOpenAIChatModel } from "@/lib/models/openai";
import type { LiveConfig } from "@/lib/server/live-config";
import { costMicroUsd, worstCaseMicroUsd } from "@/lib/usage/cost";
import { monthSpendMicroUsd, reserveUsage, settleUsage } from "@/lib/usage/ledger";

export type StoredTurn = {
  replyId: string;
  reply: string;
  status: ThreadStatus;
  unanswered: boolean;
  activity: Activity[];
  approvals: { id: string; summary: string }[];
  leads?: number;
  usage?: { model: string; costMicroUsd: number; modelRounds: number; inputTokens: number; outputTokens: number };
  spentMicroUsd?: number;
};

export type TurnFailure = { ok: false; code: "budget_exhausted" | "model_error" };

async function updateStatus(admin: SupabaseClient, tenantId: string, conversationId: string, handoff: boolean) {
  const { count } = await admin
    .from("hc_approvals")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("conversation_id", conversationId)
    .eq("status", "pending");
  const status = statusAfterTurn({ pendingApprovals: count ?? 0, handoff, mode: "ai" });
  await admin.from("hc_conversations").update({ status }).eq("tenant_id", tenantId).eq("id", conversationId);
  return status;
}

// One live AI reply for a stored conversation whose latest message is the
// customer's. Reserves budget first, settles at measured cost, and stores the
// reply and any approvals with the service role.
export async function runLiveTurn(
  admin: SupabaseClient,
  config: LiveConfig,
  target: { tenantId: string; conversationId: string; question: string },
): Promise<({ ok: true } & StoredTurn) | TurnFailure> {
  const tenant = { tenantId: target.tenantId };
  const history = await historyForModel(admin, tenant, target.conversationId, MAX_HISTORY_MESSAGES);
  const context = await loadAgentContext(admin, tenant);
  const worstCase = worstCaseMicroUsd({
    promptChars: buildSystemPrompt(context).length + history.reduce((n, m) => n + m.content.length, 0),
    rounds: MAX_MODEL_ROUNDS,
    maxOutputTokens: config.maxOutputTokens,
    inputUsdPerMTok: config.inputUsdPerMTok,
    outputUsdPerMTok: config.outputUsdPerMTok,
  });
  const reservation = await reserveUsage(
    admin,
    target.tenantId,
    crypto.randomUUID(),
    worstCase,
    config.platformMonthlyCapMicroUsd,
  );
  if (!reservation) return { ok: false, code: "budget_exhausted" };

  try {
    const result = await runAgentTurn(createOpenAIChatModel(config), context, history);
    const actual = costMicroUsd(
      result.usage.inputTokens,
      result.usage.outputTokens,
      config.inputUsdPerMTok,
      config.outputUsdPerMTok,
    );
    await settleUsage(admin, target.tenantId, reservation, actual);
    const usage = { ...result.usage, costMicroUsd: actual, model: config.model };
    const replyId = crypto.randomUUID();
    const handoff = result.handoffs.length > 0;
    await appendMessages(admin, tenant, target.conversationId, [
      {
        id: replyId,
        role: "assistant",
        text: result.reply,
        engine: "live",
        meta: {
          activity: result.activity.slice(0, 12),
          unanswered: result.unanswered || undefined,
          question: result.unanswered ? target.question.slice(0, 500) : undefined,
          handoff: handoff || undefined,
          lead: result.leads.length > 0 || undefined,
          usage: { model: usage.model, costMicroUsd: actual, modelRounds: usage.modelRounds },
        },
      },
    ]);
    if (result.approvals.length > 0) {
      const { error } = await admin.from("hc_approvals").insert(
        result.approvals.map((a) => ({
          tenant_id: target.tenantId,
          id: a.id,
          conversation_id: target.conversationId,
          message_id: replyId,
          kind: a.kind,
          summary: a.summary.slice(0, 300),
          details: a.details,
          action_hash: createHash("sha256").update(JSON.stringify(a.details)).digest("hex"),
          status: "pending",
        })),
      );
      if (error) throw new Error("Could not store the approval.");
    }
    if (result.leads.length > 0) await storeLeads(admin, target.tenantId, target.conversationId, result.leads);
    const { data: before } = await admin
      .from("hc_conversations")
      .select("channel, status, title")
      .eq("tenant_id", target.tenantId)
      .eq("id", target.conversationId)
      .maybeSingle();
    const status = await updateStatus(admin, target.tenantId, target.conversationId, handoff);
    // Alerts are for real customers; the owner's own test chats stay quiet.
    if (before?.channel === "website") {
      const events: OwnerEvent[] = [
        ...result.approvals.map((a) => ({ kind: "approval" as const, conversationId: target.conversationId, summary: a.summary })),
        ...(handoff && before.status !== "handoff"
          ? [{ kind: "handoff" as const, conversationId: target.conversationId, title: before.title as string }]
          : []),
        ...result.leads.map((l) => ({
          kind: "lead" as const,
          conversationId: target.conversationId,
          name: l.name,
          contact: [l.phone, l.email].filter(Boolean).join(", "),
          interest: l.interest,
        })),
      ];
      await Promise.all(events.map((e) => notifyOwner(admin, target.tenantId, e)));
    }
    return {
      ok: true,
      leads: result.leads.length,
      replyId,
      reply: result.reply,
      status,
      unanswered: result.unanswered,
      activity: result.activity,
      approvals: result.approvals.map((a) => ({ id: a.id, summary: a.summary })),
      usage,
      spentMicroUsd: await monthSpendMicroUsd(admin, target.tenantId),
    };
  } catch (error) {
    // Unknown outcome: keep the full reservation charged.
    await settleUsage(admin, target.tenantId, reservation, null).catch(() => undefined);
    console.error("[agent] turn failed:", error instanceof Error ? `${error.name}: ${error.message}` : "unknown");
    return { ok: false, code: "model_error" };
  }
}

// Rule-based reply from the workspace's approved knowledge. Used for website
// visitors when live AI is off, out of budget, or failed. Costs nothing.
export async function runPracticeTurn(
  admin: SupabaseClient,
  target: { tenantId: string; conversationId: string; question: string },
): Promise<StoredTurn> {
  const tenant = { tenantId: target.tenantId };
  const context = await loadAgentContext(admin, tenant);
  const business = businessFromKnowledge(context.knowledge);
  const answer = answerFromBusiness(business, target.question);
  const unanswered = answer.source === UNANSWERED_SOURCE;
  const reply = unanswered ? context.identity.fallback : answer.reply;
  const replyId = crypto.randomUUID();
  const activity: Activity[] = [
    {
      label: unanswered ? "No approved answer" : `Answered from ${answer.source}`,
      detail: "Rule-based reply from approved knowledge. No AI model was called.",
      kind: "done",
    },
  ];
  await appendMessages(admin, tenant, target.conversationId, [
    {
      id: replyId,
      role: "assistant",
      text: reply,
      engine: "practice",
      meta: {
        activity,
        source: unanswered ? undefined : answer.source,
        unanswered: unanswered || undefined,
        question: unanswered ? target.question.slice(0, 500) : undefined,
      },
    },
  ]);
  const status = await updateStatus(admin, target.tenantId, target.conversationId, false);
  return { replyId, reply, status, unanswered, activity, approvals: [] };
}

// Saves the customer's details on the conversation's contact and as a lead.
// A failure here never loses the reply; it's logged instead.
async function storeLeads(admin: SupabaseClient, tenantId: string, conversationId: string, leads: Lead[]) {
  try {
    const lead = leads[0];
    const { data: conversation } = await admin
      .from("hc_conversations")
      .select("contact_id")
      .eq("tenant_id", tenantId)
      .eq("id", conversationId)
      .maybeSingle();
    let contactId = (conversation?.contact_id as string | null) ?? null;
    const details = {
      display_name: lead.name.slice(0, 120),
      ...(lead.email ? { email: lead.email.slice(0, 254) } : {}),
      ...(lead.phone ? { phone: lead.phone.slice(0, 40) } : {}),
    };
    if (contactId) {
      await admin.from("hc_contacts").update(details).eq("tenant_id", tenantId).eq("id", contactId);
    } else {
      const { data } = await admin.from("hc_contacts").insert({ tenant_id: tenantId, ...details }).select("id").single();
      contactId = (data?.id as string | undefined) ?? null;
      if (contactId)
        await admin.from("hc_conversations").update({ contact_id: contactId }).eq("tenant_id", tenantId).eq("id", conversationId);
    }
    const { error } = await admin.from("hc_leads").insert({
      tenant_id: tenantId,
      id: lead.id,
      conversation_id: conversationId,
      contact_id: contactId,
      name: lead.name.slice(0, 80),
      email: lead.email ?? null,
      phone: lead.phone ?? null,
      interest: lead.interest.slice(0, 300),
    });
    if (error) throw error;
  } catch (error) {
    console.error("[agent] could not store lead:", error instanceof Error ? error.message : "unknown");
  }
}
