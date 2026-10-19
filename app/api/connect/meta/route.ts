import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { getWorkspaceContext } from "@/lib/data/workspace";
import { metaLoginUrl, readMetaConfig } from "@/lib/server/meta";
import { secretsConfigured } from "@/lib/server/secrets";
import { getSiteUrl } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
const back = (reason: string) => `/app/crew/receptionist/channels?error=${reason}`;

// Starts "Connect Facebook & Instagram": a Facebook login where the owner
// picks which Pages (and their linked Instagram accounts) HelloCrew may use.
export async function GET(request: Request) {
  const config = readMetaConfig();
  if (!config || !secretsConfigured()) return NextResponse.redirect(new URL(back("meta_not_configured"), request.url));
  const workspace = await getWorkspaceContext(await createClient());
  if (!workspace) return NextResponse.redirect(new URL("/login?next=/app/crew/receptionist/channels", request.url));
  if (workspace.role === "viewer") return NextResponse.redirect(new URL(back("forbidden"), request.url));
  const state = randomBytes(24).toString("base64url");
  const response = NextResponse.redirect(metaLoginUrl(config, `${getSiteUrl()}/api/connect/meta/callback`, state));
  response.cookies.set("hc_meta_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/connect/meta",
    maxAge: 600,
  });
  return response;
}
