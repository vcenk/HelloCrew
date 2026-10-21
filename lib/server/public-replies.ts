import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { mayAutoPost, parseCrewStore, postingModeOf } from "@/lib/crew";
import { loadDocuments } from "@/lib/data/workspace";
import { getConnection } from "./connections";
import { postGoogleReply, type GoogleCredentials } from "./google";
import { tokenFor, type MetaCredentials } from "./inbound";
import { postPublicReply, readMetaConfig } from "./meta";
import type { Tone } from "./reputation";

type ReplyRow = { id: string; connection_id: string; kind: string; external_id: string };

// Posts a reply on Facebook, Instagram or Google and records the outcome.
export async function postReply(
  admin: SupabaseClient,
  tenantId: string,
  item: ReplyRow,
  text: string,
  decidedBy: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const finish = (patch: Record<string, unknown>) =>
    admin
      .from("hc_public_replies")
      .update({ ...patch, decided_by: decidedBy })
      .eq("tenant_id", tenantId)
      .eq("id", item.id);
  const connection = await getConnection<MetaCredentials & GoogleCredentials>(admin, tenantId, item.connection_id);
  if (!connection?.credentials) return { ok: false, error: "This account is disconnected. Reconnect it first." };
  try {
    if (item.kind === "google_review") await postGoogleReply(connection, item.external_id, text);
    else {
      const config = readMetaConfig();
      const token = tokenFor(connection.credentials);
      if (!config || !token) return { ok: false, error: "Meta isn’t set up on the server." };
      await postPublicReply(config, item.kind as "facebook_comment", item.external_id, token, text);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Posting failed.";
    await finish({ status: "failed", error: message.slice(0, 300), draft: text });
    return { ok: false, error: message };
  }
  await finish({ status: "posted", draft: text, error: null, posted_at: new Date().toISOString() });
  return { ok: true };
}

// After a draft is written: save it, and post it right away when the owner's
// Reputation manager setting allows it. Returns true when it was posted.
export async function saveDraftOrPost(
  admin: SupabaseClient,
  tenantId: string,
  item: ReplyRow,
  draft: { text: string; tone: Tone; rating?: number | null; positive?: boolean },
): Promise<boolean> {
  await admin
    .from("hc_public_replies")
    .update({ status: "drafted", draft: draft.text })
    .eq("tenant_id", tenantId)
    .eq("id", item.id);
  const documents = await loadDocuments(admin, { tenantId }).catch(() => ({}) as Awaited<ReturnType<typeof loadDocuments>>);
  const mode = postingModeOf(parseCrewStore(documents.crew?.document));
  if (!mayAutoPost(mode, draft)) return false;
  const result = await postReply(admin, tenantId, item, draft.text, null);
  return result.ok;
}
