import { createHash } from "node:crypto";
import { z } from "zod";

import {
  runAgentTurn,
  MAX_HISTORY_MESSAGES,
  MAX_MODEL_ROUNDS,
} from "@/lib/agent/graph";
import { loadAgentContext } from "@/lib/agent/load";
import { buildSystemPrompt } from "@/lib/agent/prompt";
import { statusAfterTurn, titleFrom } from "@/lib/conversations";
import {
  appendMessages,
  createThread,
  historyForModel,
} from "@/lib/data/conversations";
import { getWorkspaceContext } from "@/lib/data/workspace";
import { createOpenAIChatModel } from "@/lib/models/openai";
import { readLiveConfig } from "@/lib/server/live-config";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { isSameOrigin } from "@/lib/server/request-safety";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { costMicroUsd, worstCaseMicroUsd } from "@/lib/usage/cost";
import {
  getTenantLimits,
  monthSpendMicroUsd,
  reserveUsage,
  settleUsage,
} from "@/lib/usage/ledger";

export const runtime = "nodejs";
export const maxDuration = 60;
const MAX_BYTES = 32_768;

// The browser sends only the new customer message. History comes from the
// stored conversation, so a client can't rewrite what was said before.
const bodySchema = z
  .object({
    conversationId: z.string().uuid(),
    message: z
      .object({
        id: z.string().uuid(),
        text: z.string().trim().min(1).max(1500),
      })
      .strict(),
  })
  .strict();

function fail(status: number, code: string, error: string, extra?: object) {
  return Response.json(
    { code, error, ...extra },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return fail(415, "invalid", "Use JSON.");
  if (!request.headers.get("origin") || !isSameOrigin(request))
    return fail(403, "forbidden", "Cross-origin requests are not allowed.");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES)
    return fail(413, "invalid", "Request too large.");
  const limited = rateLimit(clientKey(request, "agent"), 20, 60_000);
  if (!limited.ok) return tooManyRequests(limited);

  let body: z.infer<typeof bodySchema>;
  try {
    const text = await request.text();
    if (text.length > MAX_BYTES)
      return fail(413, "invalid", "Request too large.");
    const parsed = bodySchema.safeParse(JSON.parse(text));
    if (!parsed.success) return fail(400, "invalid", "Invalid conversation.");
    body = parsed.data;
  } catch {
    return fail(400, "invalid", "Invalid JSON.");
  }

  if (!isSupabaseConfigured())
    return fail(503, "not_configured", "Accounts are not configured.");
  const supabase = await createClient();
  const workspace = await getWorkspaceContext(supabase);
  if (!workspace) return fail(401, "signed_out", "Sign in to use live AI.");
  if (workspace.role === "viewer")
    return fail(403, "forbidden", "Viewers cannot run live AI.");

  const live = readLiveConfig();
  if (!live.ready)
    return fail(
      503,
      "not_configured",
      "Live AI is not configured on this server.",
      {
        missing: live.missing,
      },
    );
  const { config } = live;
  const admin = createAdminClient(config.supabaseSecretKey);

  const limits = await getTenantLimits(admin, workspace.tenantId);
  if (!limits.liveAiEnabled)
    return fail(403, "live_off", "Turn on live AI in Settings first.");

  // Load or start the conversation (RLS-scoped to this workspace).
  const { data: thread, error: threadError } = await supabase
    .from("hc_conversations")
    .select("id, channel, mode")
    .eq("tenant_id", workspace.tenantId)
    .eq("id", body.conversationId)
    .maybeSingle();
  if (threadError) return fail(500, "error", "Could not load the conversation.");
  if (thread && thread.channel !== "test")
    return fail(403, "forbidden", "Customer chats are answered by the website channel.");
  if (thread?.mode === "human")
    return fail(409, "human_mode", "You’ve taken over this chat. Hand it back to let the AI reply.");
  try {
    if (!thread)
      await createThread(supabase, workspace, {
        id: body.conversationId,
        firstMessage: body.message.text,
      });
    await appendMessages(supabase, workspace, body.conversationId, [
      { id: body.message.id, role: "customer", text: body.message.text, engine: "live" },
    ]);
  } catch (error) {
    return fail(500, "error", error instanceof Error ? error.message : "Could not save the message.");
  }
  const history = await historyForModel(
    supabase,
    workspace,
    body.conversationId,
    MAX_HISTORY_MESSAGES,
  );

  const context = await loadAgentContext(supabase, workspace);
  const promptChars =
    buildSystemPrompt(context).length +
    history.reduce((n, m) => n + m.content.length, 0);
  const worstCase = worstCaseMicroUsd({
    promptChars,
    rounds: MAX_MODEL_ROUNDS,
    maxOutputTokens: config.maxOutputTokens,
    inputUsdPerMTok: config.inputUsdPerMTok,
    outputUsdPerMTok: config.outputUsdPerMTok,
  });
  const requestId = crypto.randomUUID();
  const reservation = await reserveUsage(
    admin,
    workspace.tenantId,
    requestId,
    worstCase,
    config.platformMonthlyCapMicroUsd,
  );
  if (!reservation)
    return fail(
      402,
      "budget_exhausted",
      "This month's live AI budget is used up. Replies fall back to practice mode.",
      { budgetMicroUsd: limits.monthlyBudgetMicroUsd },
    );

  try {
    const result = await runAgentTurn(
      createOpenAIChatModel(config),
      context,
      history,
    );
    const actual = costMicroUsd(
      result.usage.inputTokens,
      result.usage.outputTokens,
      config.inputUsdPerMTok,
      config.outputUsdPerMTok,
    );
    await settleUsage(admin, workspace.tenantId, reservation, actual);
    const usage = { ...result.usage, costMicroUsd: actual, model: config.model };

    // Store the reply and any approvals with the service role: these are
    // server facts, never written by the browser.
    const replyId = crypto.randomUUID();
    const handoff = result.handoffs.length > 0;
    await appendMessages(admin, workspace, body.conversationId, [
      {
        id: replyId,
        role: "assistant",
        text: result.reply,
        engine: "live",
        meta: {
          activity: result.activity.slice(0, 12),
          unanswered: result.unanswered || undefined,
          question: result.unanswered ? body.message.text.slice(0, 500) : undefined,
          handoff: handoff || undefined,
          usage: { model: usage.model, costMicroUsd: actual, modelRounds: usage.modelRounds },
        },
      },
    ]);
    if (result.approvals.length > 0) {
      const { error: approvalError } = await admin.from("hc_approvals").insert(
        result.approvals.map((a) => ({
          tenant_id: workspace.tenantId,
          id: a.id,
          conversation_id: body.conversationId,
          message_id: replyId,
          kind: a.kind,
          summary: a.summary.slice(0, 300),
          details: a.details,
          action_hash: createHash("sha256").update(JSON.stringify(a.details)).digest("hex"),
          status: "pending",
        })),
      );
      if (approvalError) throw new Error("Could not store the approval.");
    }
    const { count: pending } = await admin
      .from("hc_approvals")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", workspace.tenantId)
      .eq("conversation_id", body.conversationId)
      .eq("status", "pending");
    const status = statusAfterTurn({ pendingApprovals: pending ?? 0, handoff, mode: "ai" });
    await admin
      .from("hc_conversations")
      .update({ status })
      .eq("tenant_id", workspace.tenantId)
      .eq("id", body.conversationId);

    const spent = await monthSpendMicroUsd(admin, workspace.tenantId);
    return Response.json(
      {
        conversationId: body.conversationId,
        title: titleFrom(history.find((m) => m.role === "user")?.content ?? body.message.text),
        status,
        messageId: replyId,
        reply: result.reply,
        unanswered: result.unanswered,
        activity: result.activity,
        approvals: result.approvals,
        handoffs: result.handoffs,
        usage,
        spentMicroUsd: spent,
        budgetMicroUsd: limits.monthlyBudgetMicroUsd,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    // Unknown outcome: keep the full reservation charged.
    await settleUsage(admin, workspace.tenantId, reservation, null).catch(
      () => undefined,
    );
    console.error(
      "[agent] turn failed:",
      error instanceof Error ? `${error.name}: ${error.message}` : "unknown",
    );
    return fail(502, "model_error", "The AI model did not answer. Try again.");
  }
}
