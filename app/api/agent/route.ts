import { z } from "zod";

import {
  runAgentTurn,
  MAX_HISTORY_MESSAGES,
  MAX_MODEL_ROUNDS,
} from "@/lib/agent/graph";
import { loadAgentContext } from "@/lib/agent/load";
import { buildSystemPrompt } from "@/lib/agent/prompt";
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

const bodySchema = z
  .object({
    messages: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().trim().min(1).max(1500),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_HISTORY_MESSAGES),
  })
  .strict()
  .refine((b) => b.messages[b.messages.length - 1].role === "user", {
    message: "The last message must come from the customer.",
  });

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

  const context = await loadAgentContext(supabase, workspace);
  const promptChars =
    buildSystemPrompt(context).length +
    body.messages.reduce((n, m) => n + m.content.length, 0);
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
      body.messages,
    );
    const actual = costMicroUsd(
      result.usage.inputTokens,
      result.usage.outputTokens,
      config.inputUsdPerMTok,
      config.outputUsdPerMTok,
    );
    await settleUsage(admin, workspace.tenantId, reservation, actual);
    const spent = await monthSpendMicroUsd(admin, workspace.tenantId);
    return Response.json(
      {
        reply: result.reply,
        unanswered: result.unanswered,
        activity: result.activity,
        approvals: result.approvals,
        handoffs: result.handoffs,
        usage: { ...result.usage, costMicroUsd: actual, model: config.model },
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
