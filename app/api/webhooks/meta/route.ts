import { after } from "next/server";

import { handleMetaEvent, recordArrival } from "@/lib/server/inbound";
import { parseMetaWebhook, readMetaConfig, verifyMetaSignature } from "@/lib/server/meta";
import { widgetAdminClient } from "@/lib/server/widget-installations";

export const runtime = "nodejs";
export const maxDuration = 60;
const MAX_BYTES = 512 * 1024;

// Meta checks the endpoint once when the webhook is set up.
export function GET(request: Request) {
  const config = readMetaConfig();
  const url = new URL(request.url);
  if (
    config &&
    url.searchParams.get("hub.mode") === "subscribe" &&
    url.searchParams.get("hub.verify_token") === config.verifyToken
  )
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  return new Response("Forbidden", { status: 403 });
}

// Messages, comments and recommendations from connected Pages, Instagram
// accounts and WhatsApp numbers. Answer fast; do the work after responding.
export async function POST(request: Request) {
  const config = readMetaConfig();
  const admin = widgetAdminClient();
  if (!config || !admin) return new Response("Not configured", { status: 503 });
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return new Response("Too large", { status: 413 });
  if (!verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), config.appSecret)) {
    console.warn("[meta] webhook rejected: signature does not match META_APP_SECRET");
    return new Response("Bad signature", { status: 401 });
  }
  let events;
  try {
    events = parseMetaWebhook(JSON.parse(raw));
  } catch {
    return new Response("Bad payload", { status: 400 });
  }
  console.info(`[meta] webhook received: ${events.length} event(s)`);
  const batch = events.slice(0, 50);

  // Durable before the 200, because the 200 is a promise we will not get a
  // second chance at: Meta does not redeliver an event it was told arrived,
  // and `after` runs under waitUntil, so the invocation can be cut off
  // partway through the work. If that happens, these rows are the only
  // record the events existed, and the sweeper replays them from here.
  try {
    for (const event of batch) await recordArrival(admin, event);
  } catch (error) {
    // Could not persist. Better to let Meta retry the whole delivery than to
    // accept events we might silently drop.
    console.error("[meta] could not record delivery:", error instanceof Error ? error.message : "unknown");
    return new Response("Storage unavailable", { status: 503 });
  }

  if (batch.length)
    after(async () => {
      for (const event of batch) await handleMetaEvent(admin, config, event);
    });
  return new Response("EVENT_RECEIVED", { status: 200 });
}
