import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { getWorkspaceContext } from "@/lib/data/workspace";
import { ConnectionTakenError, saveConnection } from "@/lib/server/connections";
import { exchangeGoogleCode, GoogleApiError, listGoogleLocations } from "@/lib/server/google";
import { widgetAdminClient } from "@/lib/server/widget-installations";
import { getSiteUrl } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

function done(request: NextRequest, query: string) {
  const response = NextResponse.redirect(new URL(`/app/crew/reputation?${query}`, request.url));
  response.cookies.delete({ name: "hc_google_state", path: "/api/connect/google" });
  return response;
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  if (url.searchParams.get("error")) return done(request, "error=google_cancelled");
  const expected = request.cookies.get("hc_google_state")?.value;
  const given = url.searchParams.get("state");
  if (!expected || !given || expected.length !== given.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(given)))
    return done(request, "error=google_state");
  const admin = widgetAdminClient();
  const workspace = await getWorkspaceContext(await createClient());
  if (!admin) return done(request, "error=google_not_configured");
  if (!workspace || workspace.role === "viewer") return done(request, "error=forbidden");

  let tokens;
  let locations;
  try {
    tokens = await exchangeGoogleCode(url.searchParams.get("code") ?? "", `${getSiteUrl()}/api/connect/google/callback`);
    if (!tokens.refresh_token) return done(request, "error=google_no_refresh");
    locations = await listGoogleLocations(tokens.access_token!);
  } catch (error) {
    const reason = error instanceof GoogleApiError && (error.status === 403 || error.status === 429) ? "google_not_approved" : "google_login";
    console.error("[google] connect failed:", error instanceof Error ? error.message : "unknown");
    return done(request, `error=${reason}`);
  }
  if (locations.length === 0) return done(request, "error=google_no_locations");
  let connected = 0;
  let taken = false;
  for (const location of locations.slice(0, 10)) {
    try {
      await saveConnection(admin, {
        tenantId: workspace.tenantId,
        provider: "google",
        kind: "google_location",
        externalId: location.name,
        displayName: location.title,
        credentials: { refreshToken: tokens.refresh_token },
        createdBy: workspace.userId,
      });
      connected++;
    } catch (error) {
      if (error instanceof ConnectionTakenError) taken = true;
    }
  }
  return done(request, `connected=${connected}${taken ? "&error=google_taken" : ""}`);
}
