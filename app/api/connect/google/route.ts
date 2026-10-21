import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { getWorkspaceContext } from "@/lib/data/workspace";
import { googleLoginUrl, readGoogleConfig } from "@/lib/server/google";
import { secretsConfigured } from "@/lib/server/secrets";
import { getSiteUrl } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
const back = (reason: string) => `/app/connections?error=${reason}`;

// Starts "Connect Google": the owner signs in with the Google account that
// manages their Business Profile and allows HelloCrew to reply to reviews.
export async function GET(request: Request) {
  const config = readGoogleConfig();
  if (!config || !secretsConfigured()) return NextResponse.redirect(new URL(back("google_not_configured"), request.url));
  const workspace = await getWorkspaceContext(await createClient());
  if (!workspace) return NextResponse.redirect(new URL("/login?next=/app/connections", request.url));
  if (workspace.role === "viewer") return NextResponse.redirect(new URL(back("forbidden"), request.url));
  const state = randomBytes(24).toString("base64url");
  const response = NextResponse.redirect(googleLoginUrl(config.clientId, `${getSiteUrl()}/api/connect/google/callback`, state));
  response.cookies.set("hc_google_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/connect/google",
    maxAge: 600,
  });
  return response;
}
