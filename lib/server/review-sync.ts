import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Connection } from "./connections";
import { markConnectionError } from "./connections";
import { fetchRecentReviews, type GoogleCredentials } from "./google";
import { notifyOwner } from "./notify";
import { saveDraftOrPost } from "./public-replies";
import { draftPublicReply } from "./reputation";

// Only reviews from the last 30 days are picked up on the first sync, so
// connecting an old location doesn't flood Today with years of reviews.
const FIRST_SYNC_DAYS = 30;

export async function syncGoogleLocation(admin: SupabaseClient, connection: Connection<GoogleCredentials>, lastSyncedAt: string | null) {
  let reviews;
  try {
    reviews = await fetchRecentReviews(connection);
  } catch (error) {
    await markConnectionError(admin, connection.tenantId, connection.id, error instanceof Error ? error.message : "Sync failed.");
    return 0;
  }
  const since = lastSyncedAt ? Date.parse(lastSyncedAt) - 3600_000 : Date.now() - FIRST_SYNC_DAYS * 86_400_000;
  let added = 0;
  for (const review of reviews) {
    if (review.answered || Date.parse(review.createdAt) < since) continue;
    const { data } = await admin
      .from("hc_public_replies")
      .upsert(
        {
          tenant_id: connection.tenantId,
          connection_id: connection.id,
          kind: "google_review",
          external_id: review.name,
          author_name: review.authorName?.slice(0, 120) ?? null,
          body: review.comment.slice(0, 8000),
          rating: review.rating,
          received_at: review.createdAt,
        },
        { onConflict: "connection_id,external_id", ignoreDuplicates: true },
      )
      .select("id");
    const id = data?.[0]?.id as string | undefined;
    if (!id) continue;
    added++;
    const { draft, skip, tone } = await draftPublicReply(admin, connection.tenantId, {
      kind: "google_review",
      authorName: review.authorName,
      body: review.comment,
      rating: review.rating,
    });
    const row = { id, connection_id: connection.id, kind: "google_review", external_id: review.name };
    const posted = draft
      ? await saveDraftOrPost(admin, connection.tenantId, row, { text: draft, tone, rating: review.rating })
      : false;
    if (!skip && !posted)
      await notifyOwner(admin, connection.tenantId, {
        kind: "public_reply",
        network: "Google",
        author: review.authorName ?? "A customer",
        text: review.comment || `${review.rating ?? "?"} stars`,
      });
  }
  await admin
    .from("hc_channel_connections")
    .update({ last_synced_at: new Date().toISOString(), last_error: null })
    .eq("tenant_id", connection.tenantId)
    .eq("id", connection.id);
  return added;
}
