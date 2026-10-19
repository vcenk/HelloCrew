import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

// Meta (Facebook Pages, Messenger, Instagram, WhatsApp Cloud API).
// Everything here is server-side; tokens never reach the browser.

export type MetaConfig = {
  appId: string;
  appSecret: string;
  verifyToken: string;
  version: string;
};

export function readMetaConfig(env: Record<string, string | undefined> = process.env): MetaConfig | null {
  const appId = env.META_APP_ID?.trim();
  const appSecret = env.META_APP_SECRET?.trim();
  const verifyToken = env.META_WEBHOOK_VERIFY_TOKEN?.trim();
  if (!appId || !appSecret || !verifyToken) return null;
  return { appId, appSecret, verifyToken, version: env.META_GRAPH_VERSION?.trim() || "v25.0" };
}

export const META_SCOPES = [
  "pages_show_list",
  "pages_manage_metadata",
  "pages_messaging",
  "pages_read_engagement",
  "pages_read_user_content",
  "pages_manage_engagement",
  "instagram_basic",
  "instagram_manage_messages",
  "instagram_manage_comments",
  "business_management",
];

export const PAGE_WEBHOOK_FIELDS = ["messages", "feed", "ratings"];

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
}

// Meta signs every webhook with the app secret (X-Hub-Signature-256).
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string) {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function metaLoginUrl(config: MetaConfig, redirectUri: string, state: string) {
  const url = new URL(`https://www.facebook.com/${config.version}/dialog/oauth`);
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", META_SCOPES.join(","));
  return url.toString();
}

async function graph<T>(
  config: MetaConfig,
  path: string,
  init: { method?: "GET" | "POST"; token?: string; query?: Record<string, string>; body?: unknown } = {},
): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${config.version}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const response = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
  if (!response.ok || data.error)
    throw new MetaApiError(data.error?.message ?? `Meta request failed (${response.status}).`, data.error?.code);
  return data;
}

export type ConnectablePage = {
  pageId: string;
  pageName: string;
  pageToken: string;
  instagram: { id: string; username: string } | null;
};

// Code → long-lived user token → the Pages (and linked Instagram accounts)
// the owner granted. Page tokens derived this way don't expire.
export async function pagesFromLogin(config: MetaConfig, code: string, redirectUri: string): Promise<ConnectablePage[]> {
  const short = await graph<{ access_token: string }>(config, "oauth/access_token", {
    query: { client_id: config.appId, client_secret: config.appSecret, redirect_uri: redirectUri, code },
  });
  const long = await graph<{ access_token: string }>(config, "oauth/access_token", {
    query: {
      grant_type: "fb_exchange_token",
      client_id: config.appId,
      client_secret: config.appSecret,
      fb_exchange_token: short.access_token,
    },
  });
  const pages = await graph<{
    data: { id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } }[];
  }>(config, "me/accounts", {
    token: long.access_token,
    query: { fields: "id,name,access_token,instagram_business_account{id,username}", limit: "50" },
  });
  return pages.data.map((p) => ({
    pageId: p.id,
    pageName: p.name,
    pageToken: p.access_token,
    instagram: p.instagram_business_account
      ? { id: p.instagram_business_account.id, username: p.instagram_business_account.username ?? "Instagram" }
      : null,
  }));
}

export async function subscribePage(config: MetaConfig, pageId: string, pageToken: string) {
  await graph(config, `${pageId}/subscribed_apps`, {
    method: "POST",
    token: pageToken,
    query: { subscribed_fields: PAGE_WEBHOOK_FIELDS.join(",") },
  });
}

export async function checkWhatsAppNumber(config: MetaConfig, phoneNumberId: string, token: string) {
  return graph<{ id: string; display_phone_number?: string; verified_name?: string }>(config, phoneNumberId, {
    token,
    query: { fields: "id,display_phone_number,verified_name" },
  });
}

// ---------- Sending ----------

const limits = { messenger: 2000, instagram: 1000, whatsapp: 4096 } as const;

export async function sendDirectMessage(
  config: MetaConfig,
  channel: "messenger" | "instagram" | "whatsapp",
  target: { externalId: string; token: string; recipient: string },
  text: string,
) {
  const body = text.slice(0, limits[channel]);
  if (channel === "whatsapp")
    return graph(config, `${target.externalId}/messages`, {
      method: "POST",
      token: target.token,
      body: { messaging_product: "whatsapp", recipient_type: "individual", to: target.recipient, type: "text", text: { preview_url: false, body } },
    });
  return graph(config, "me/messages", {
    method: "POST",
    token: target.token,
    body: { recipient: { id: target.recipient }, messaging_type: "RESPONSE", message: { text: body } },
  });
}

export async function postPublicReply(
  config: MetaConfig,
  kind: "facebook_comment" | "instagram_comment" | "facebook_recommendation",
  externalId: string,
  token: string,
  text: string,
) {
  const path = kind === "instagram_comment" ? `${externalId}/replies` : `${externalId}/comments`;
  return graph<{ id: string }>(config, path, { method: "POST", token, body: { message: text.slice(0, 2000) } });
}

// ---------- Incoming webhooks ----------

export type MetaInbound =
  | {
      type: "message";
      channel: "messenger" | "instagram" | "whatsapp";
      accountId: string; // page id, Instagram account id, or WhatsApp phone number id
      threadId: string; // sender PSID / IGSID / WhatsApp number
      senderName?: string;
      messageId: string;
      text: string;
    }
  | {
      type: "public";
      kind: "facebook_comment" | "instagram_comment" | "facebook_recommendation";
      accountId: string;
      externalId: string; // comment id, or the recommendation's story id
      parentId?: string;
      authorId?: string;
      authorName?: string;
      text: string;
      positive?: boolean;
    };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined);

// Turns a webhook payload into the events HelloCrew handles. Anything else
// (delivery receipts, reactions, our own echoes, edits) is ignored.
export function parseMetaWebhook(payload: unknown): MetaInbound[] {
  const root = obj(payload);
  const out: MetaInbound[] = [];
  const entries = Array.isArray(root.entry) ? root.entry : [];
  for (const rawEntry of entries) {
    const entry = obj(rawEntry);
    const accountId = str(entry.id) ?? "";
    if (root.object === "page" || root.object === "instagram") {
      const channel = root.object === "page" ? "messenger" : "instagram";
      for (const rawEvent of Array.isArray(entry.messaging) ? entry.messaging : []) {
        const event = obj(rawEvent);
        const message = obj(event.message);
        const text = str(message.text);
        const sender = str(obj(event.sender).id);
        if (!text || !sender || message.is_echo || sender === accountId) continue;
        out.push({ type: "message", channel, accountId, threadId: sender, messageId: str(message.mid) ?? `${sender}:${str(event.timestamp)}`, text });
      }
      for (const rawChange of Array.isArray(entry.changes) ? entry.changes : []) {
        const change = obj(rawChange);
        const value = obj(change.value);
        if (root.object === "page" && change.field === "feed" && value.item === "comment" && value.verb === "add") {
          const from = obj(value.from);
          const text = str(value.message);
          const id = str(value.comment_id);
          if (!text || !id || str(from.id) === accountId) continue;
          out.push({ type: "public", kind: "facebook_comment", accountId, externalId: id, parentId: str(value.post_id), authorId: str(from.id), authorName: str(from.name), text });
        }
        if (root.object === "page" && change.field === "ratings" && str(value.open_graph_story_id)) {
          const text = str(value.review_text) ?? "";
          if (value.verb && value.verb !== "add") continue;
          out.push({
            type: "public",
            kind: "facebook_recommendation",
            accountId,
            externalId: str(value.open_graph_story_id)!,
            authorId: str(value.reviewer_id),
            authorName: str(value.reviewer_name),
            text,
            positive: value.recommendation_type === "positive",
          });
        }
        if (root.object === "instagram" && change.field === "comments") {
          const from = obj(value.from);
          const text = str(value.text);
          const id = str(value.id);
          if (!text || !id || str(from.id) === accountId) continue;
          out.push({ type: "public", kind: "instagram_comment", accountId, externalId: id, parentId: str(obj(value.media).id), authorId: str(from.id), authorName: str(from.username), text });
        }
      }
    }
    if (root.object === "whatsapp_business_account") {
      for (const rawChange of Array.isArray(entry.changes) ? entry.changes : []) {
        const value = obj(obj(rawChange).value);
        const phoneNumberId = str(obj(value.metadata).phone_number_id);
        const names = new Map(
          (Array.isArray(value.contacts) ? value.contacts : []).map((c) => [str(obj(c).wa_id), str(obj(obj(c).profile).name)]),
        );
        for (const rawMessage of Array.isArray(value.messages) ? value.messages : []) {
          const message = obj(rawMessage);
          const text = message.type === "text" ? str(obj(message.text).body) : undefined;
          const from = str(message.from);
          if (!text || !from || !phoneNumberId) continue;
          out.push({ type: "message", channel: "whatsapp", accountId: phoneNumberId, threadId: from, senderName: names.get(from), messageId: str(message.id) ?? `${from}:${str(message.timestamp)}`, text });
        }
      }
    }
  }
  return out;
}
