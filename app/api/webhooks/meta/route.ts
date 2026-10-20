import { after } from "next/server";

import { handleMetaEvent } from "@/lib/server/inbound";
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
  if (events.length)
    after(async () => {
      for (const event of events.slice(0, 50)) await handleMetaEvent(admin, config, event);
    });
  return new Response("EVENT_RECEIVED", { status: 200 });
}
