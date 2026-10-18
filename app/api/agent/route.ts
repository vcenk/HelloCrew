import { z } from "zod";

import { appendMessages, createThread } from "@/lib/data/conversations";
import { getWorkspaceContext } from "@/lib/data/workspace";
import { runLiveTurn } from "@/lib/server/agent-turn";
import { readLiveConfig } from "@/lib/server/live-config";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { isSameOrigin } from "@/lib/server/request-safety";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { getTenantLimits } from "@/lib/usage/ledger";

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
  const turn = await runLiveTurn(admin, config, {
    tenantId: workspace.tenantId,
    conversationId: body.conversationId,
    question: body.message.text,
  });
  if (!turn.ok)
    return turn.code === "budget_exhausted"
      ? fail(
          402,
          "budget_exhausted",
          "This month's live AI budget is used up. Replies fall back to practice mode.",
          { budgetMicroUsd: limits.monthlyBudgetMicroUsd },
        )
      : fail(502, "model_error", "The AI model did not answer. Try again.");
  return Response.json(
    {
      conversationId: body.conversationId,
      status: turn.status,
      messageId: turn.replyId,
      reply: turn.reply,
      unanswered: turn.unanswered,
      activity: turn.activity,
      approvals: turn.approvals,
      usage: turn.usage,
      spentMicroUsd: turn.spentMicroUsd,
      budgetMicroUsd: limits.monthlyBudgetMicroUsd,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
