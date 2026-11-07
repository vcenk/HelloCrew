import { timingSafeEqual } from "node:crypto";

import { decryptSecret } from "@/lib/server/secrets";
import type { Connection } from "@/lib/server/connections";
import type { GoogleCredentials } from "@/lib/server/google";
import { googleConfigured } from "@/lib/server/google";
import { retryStuckMetaEvents } from "@/lib/server/inbound";
import { readMetaConfig } from "@/lib/server/meta";
import { syncGoogleLocation } from "@/lib/server/review-sync";
import { widgetAdminClient } from "@/lib/server/widget-installations";

export const runtime = "nodejs";
export const maxDuration = 300;

// Vercel Cron calls this with "Authorization: Bearer $CRON_SECRET".
function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  return Boolean(secret) && header.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

export async function GET(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  const admin = widgetAdminClient();
  if (!admin || !googleConfigured()) return Response.json({ synced: 0, reason: "not_configured" });
  const { data } = await admin
    .from("hc_channel_connections")
    .select("*")
    .eq("kind", "google_location")
    .eq("status", "connected")
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(25);
  let added = 0;
  for (const row of data ?? []) {
    let credentials: GoogleCredentials | null = null;
    try {
      credentials = decryptSecret<GoogleCredentials>(row.credentials as string);
    } catch {
      credentials = null;
    }
    const connection: Connection<GoogleCredentials> = {
      tenantId: row.tenant_id,
      id: row.id,
      provider: "google",
      kind: "google_location",
      externalId: row.external_id,
      displayName: row.display_name,
      status: row.status,
      settings: row.settings ?? {},
      credentials,
    };
    added += await syncGoogleLocation(admin, connection, row.last_synced_at ?? null);
  }
  // Finish Meta deliveries that were accepted and never completed. The
  // webhook answers 200 before doing the work, so Meta will not redeliver,
  // and `after` can be cut off by the invocation's time limit: without this
  // pass, an interrupted event would stay unfinished forever. Allowed to
  // fail on its own, since it has nothing to do with review syncing.
  let recovered: unknown = { found: 0, finished: 0 };
  const meta = readMetaConfig();
  if (meta) {
    try {
      recovered = await retryStuckMetaEvents(admin, meta);
    } catch (error) {
      console.error(
        "[cron/google-reviews] webhook recovery failed:",
        error instanceof Error ? error.message : "unknown",
      );
      recovered = { reason: "error" };
    }
  }

  // Housekeeping: webhook ids older than a week can't be retried anymore.
  await admin.from("hc_webhook_events").delete().lt("received_at", new Date(Date.now() - 7 * 86_400_000).toISOString());
  return Response.json({ synced: data?.length ?? 0, added, recovered });
}
