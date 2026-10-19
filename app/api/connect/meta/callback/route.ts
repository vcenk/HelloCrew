import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { getWorkspaceContext } from "@/lib/data/workspace";
import { ConnectionTakenError, saveConnection } from "@/lib/server/connections";
import { MetaApiError, pagesFromLogin, readMetaConfig, subscribePage } from "@/lib/server/meta";
import { widgetAdminClient } from "@/lib/server/widget-installations";
import { getSiteUrl } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

function done(request: NextRequest, query: string) {
  const response = NextResponse.redirect(new URL(`/app/crew/receptionist/channels?${query}`, request.url));
  response.cookies.delete({ name: "hc_meta_state", path: "/api/connect/meta" });
  return response;
}

function sameState(a: string | undefined, b: string | null) {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  if (url.searchParams.get("error")) return done(request, "error=meta_cancelled");
  if (!sameState(request.cookies.get("hc_meta_state")?.value, url.searchParams.get("state")))
    return done(request, "error=meta_state");
  const config = readMetaConfig();
  const admin = widgetAdminClient();
  const workspace = await getWorkspaceContext(await createClient());
  if (!config || !admin) return done(request, "error=meta_not_configured");
  if (!workspace || workspace.role === "viewer") return done(request, "error=forbidden");

  let pages;
  try {
    pages = await pagesFromLogin(config, url.searchParams.get("code") ?? "", `${getSiteUrl()}/api/connect/meta/callback`);
  } catch (error) {
    console.error("[meta] login failed:", error instanceof MetaApiError ? error.message : "unknown");
    return done(request, "error=meta_login");
  }
  if (pages.length === 0) return done(request, "error=meta_no_pages");

  let connected = 0;
  const taken: string[] = [];
  for (const page of pages) {
    try {
      await subscribePage(config, page.pageId, page.pageToken);
      await saveConnection(admin, {
        tenantId: workspace.tenantId,
        provider: "meta",
        kind: "facebook_page",
        externalId: page.pageId,
        displayName: page.pageName,
        credentials: { pageToken: page.pageToken },
        createdBy: workspace.userId,
      });
      connected++;
      if (page.instagram) {
        await saveConnection(admin, {
          tenantId: workspace.tenantId,
          provider: "meta",
          kind: "instagram",
          externalId: page.instagram.id,
          displayName: `@${page.instagram.username}`,
          credentials: { pageToken: page.pageToken },
          settings: { pageId: page.pageId },
          createdBy: workspace.userId,
        });
        connected++;
      }
    } catch (error) {
      if (error instanceof ConnectionTakenError) taken.push(page.pageName);
      else console.error("[meta] connect page failed:", error instanceof Error ? error.message : "unknown");
    }
  }
  return done(request, `connected=${connected}${taken.length ? "&error=meta_taken" : ""}`);
}
