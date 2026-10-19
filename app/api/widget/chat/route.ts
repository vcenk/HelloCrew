import { titleFrom } from "@/lib/conversations";
import { appendMessages } from "@/lib/data/conversations";
import { runLiveTurn, runPracticeTurn } from "@/lib/server/agent-turn";
import { readLiveConfig } from "@/lib/server/live-config";
import { notifyOwner } from "@/lib/server/notify";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { isSameOrigin } from "@/lib/server/request-safety";
import {
  hashVisitorToken,
  loadPublicInstallation,
  newVisitorToken,
  widgetAdminClient,
} from "@/lib/server/widget-installations";
import { getTenantLimits } from "@/lib/usage/ledger";
import { PUBLIC_WIDGET_ID, widgetChatRequestSchema, type WidgetChatMessage } from "@/lib/widget";

export const runtime = "nodejs";
export const maxDuration = 60;
const MAX_BYTES = 4096;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

type Admin = NonNullable<ReturnType<typeof widgetAdminClient>>;

// The visitor proves a conversation is theirs with the token issued when it
// started. Only its hash is stored.
async function visitorConversation(admin: Admin, tenantId: string, id: string, token: string) {
  const { data } = await admin
    .from("hc_conversations")
    .select("id, mode, status, visitor_token_hash")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .eq("channel", "website")
    .maybeSingle();
  if (!data || data.visitor_token_hash !== hashVisitorToken(token)) return null;
  return data as { id: string; mode: "ai" | "human"; status: string };
}

async function messagesAfter(admin: Admin, tenantId: string, conversationId: string, after: string) {
  const { data } = await admin
    .from("hc_messages")
    .select("id, role, body, created_at")
    .eq("tenant_id", tenantId)
    .eq("conversation_id", conversationId)
    .gt("created_at", after)
    .order("created_at", { ascending: true })
    .limit(100);
  return (data ?? []).map(
    (row): WidgetChatMessage => ({
      id: row.id as string,
      role: row.role as WidgetChatMessage["role"],
      text: row.body as string,
      at: row.created_at as string,
    }),
  );
}

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return json({ error: "Use JSON." }, 415);
  // Requests come from the widget frame, which is served by this site.
  if (!request.headers.get("origin") || !isSameOrigin(request))
    return json({ error: "Messages must come from the chat window." }, 403);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES)
    return json({ error: "Message too long." }, 413);
  const limited = rateLimit(clientKey(request, "widget-chat"), 12, 60_000);
  if (!limited.ok) return tooManyRequests(limited);

  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_BYTES) return json({ error: "Message too long." }, 413);
    const parsed = widgetChatRequestSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return json({ error: "That message couldn’t be sent." }, 400);
    body = parsed.data;
  } catch {
    return json({ error: "That message couldn’t be sent." }, 400);
  }

  const admin = widgetAdminClient();
  const installation = admin ? await loadPublicInstallation(body.installationId, admin) : null;
  if (!admin || !installation) return json({ error: "This chat isn’t available right now." }, 404);
  const perSite = rateLimit(`widget-site:${installation.id}`, 120, 60_000);
  if (!perSite.ok) return tooManyRequests(perSite);
  const tenantId = installation.tenantId;

  // Continue the visitor's conversation, or start a new one.
  let conversationId: string;
  let issuedToken: string | undefined;
  let mode: "ai" | "human" = "ai";
  if (body.conversation) {
    const existing = await visitorConversation(admin, tenantId, body.conversation.id, body.conversation.token);
    if (!existing) return json({ error: "This chat has expired. Start a new one.", code: "expired" }, 410);
    conversationId = existing.id;
    mode = existing.mode;
  } else {
    issuedToken = newVisitorToken();
    const { data: contact } = await admin
      .from("hc_contacts")
      .insert({ tenant_id: tenantId, display_name: "Website visitor" })
      .select("id")
      .single();
    const { data, error } = await admin
      .from("hc_conversations")
      .insert({
        tenant_id: tenantId,
        channel: "website",
        title: titleFrom(body.message),
        contact_id: contact?.id ?? null,
        visitor_token_hash: hashVisitorToken(issuedToken),
      })
      .select("id")
      .single();
    if (error || !data) return json({ error: "This chat isn’t available right now." }, 503);
    conversationId = data.id as string;
    await notifyOwner(admin, tenantId, { kind: "new_chat", conversationId, firstMessage: body.message });
  }

  const customerId = crypto.randomUUID();
  try {
    await appendMessages(admin, { tenantId }, conversationId, [
      { id: customerId, role: "customer", text: body.message, engine: mode === "human" ? "human" : undefined },
    ]);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "That message couldn’t be sent." }, 409);
  }
  const conversation = { id: conversationId, token: issuedToken };
  const target = { tenantId, conversationId, question: body.message };

  // A person has taken over: store the message and let them reply.
  const customer = { id: customerId, at: new Date().toISOString() };
  if (mode === "human") return json({ conversation, customer, replies: [], waitingForPerson: true });

  // Live AI when the owner switched it on and budget allows; otherwise the
  // free rule-based answer from approved knowledge.
  const live = readLiveConfig();
  let turn = null;
  if (live.ready) {
    const limits = await getTenantLimits(admin, tenantId).catch(() => null);
    if (limits?.liveAiEnabled) {
      const result = await runLiveTurn(admin, live.config, target);
      if (result.ok) turn = result;
    }
  }
  turn ??= await runPracticeTurn(admin, target);

  return json({
    conversation,
    customer,
    replies: [{ id: turn.replyId, role: "assistant", text: turn.reply, at: new Date().toISOString() }],
    waitingForPerson: false,
  });
}

// Polling for replies the owner (or an approval decision) added later.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const installationId = url.searchParams.get("installationId") ?? "";
  const id = url.searchParams.get("conversationId") ?? "";
  const token = url.searchParams.get("token") ?? "";
  const after = url.searchParams.get("after") ?? "1970-01-01T00:00:00Z";
  if (
    !PUBLIC_WIDGET_ID.test(installationId) ||
    !/^[0-9a-f-]{36}$/.test(id) ||
    !/^[A-Za-z0-9_-]{43}$/.test(token) ||
    Number.isNaN(Date.parse(after))
  )
    return json({ error: "Invalid request." }, 400);
  const limited = rateLimit(clientKey(request, "widget-poll"), 40, 60_000);
  if (!limited.ok) return tooManyRequests(limited);

  const admin = widgetAdminClient();
  const installation = admin ? await loadPublicInstallation(installationId, admin) : null;
  if (!admin || !installation) return json({ error: "This chat isn’t available right now." }, 404);
  const conversation = await visitorConversation(admin, installation.tenantId, id, token);
  if (!conversation) return json({ error: "This chat has expired.", code: "expired" }, 410);
  return json({
    messages: await messagesAfter(admin, installation.tenantId, id, new Date(after).toISOString()),
    waitingForPerson: conversation.mode === "human",
  });
}
