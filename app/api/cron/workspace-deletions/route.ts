import { timingSafeEqual } from "node:crypto";

import {
  advanceDeletion,
  deleteTenantStorage,
  pendingDeletions,
} from "@/lib/server/workspace-deletion";
import { widgetAdminClient } from "@/lib/server/widget-installations";

/**
 * Works through workspace deletions that have been asked for.
 *
 * A separate route rather than a branch of the reviews sweep, which returns
 * early when Google is not configured — deletion must not depend on an
 * unrelated integration being set up.
 *
 * Each run claims a lease per workspace and writes progress after every
 * step, so a run that is interrupted resumes here rather than starting over
 * or stopping forever. That is the whole reason this is a sweep and not an
 * `after()` on the request that asked.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

// Vercel Cron calls this with "Authorization: Bearer $CRON_SECRET".
function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  return (
    Boolean(secret) &&
    header.length === expected.length &&
    timingSafeEqual(Buffer.from(header), Buffer.from(expected))
  );
}

export async function GET(request: Request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });

  const admin = widgetAdminClient();
  if (!admin) return Response.json({ worked: 0, reason: "not_configured" });

  const tenants = await pendingDeletions(admin);
  const results: { status: string; steps: number }[] = [];

  for (const tenantId of tenants) {
    try {
      const state = await advanceDeletion(admin, tenantId, (id) =>
        deleteTenantStorage(admin, id),
      );
      results.push({
        status: state?.status ?? "unknown",
        // Counts only. A workspace id in a log is not needed to know the
        // sweep ran, and this runs on shared infrastructure.
        steps: Object.keys(state?.deletedCounts ?? {}).length,
      });
    } catch (error) {
      console.error(
        "[deletion] sweep failed:",
        error instanceof Error ? error.message : "unknown",
      );
      results.push({ status: "failed", steps: 0 });
    }
  }

  return Response.json({ worked: results.length, results });
}
