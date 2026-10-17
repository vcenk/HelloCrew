import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { AUTH_NEXT_COOKIE, safeNextPath } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const cookieStore = await cookies();
  const next = safeNextPath(
    requestUrl.searchParams.get("next") ??
      cookieStore.get(AUTH_NEXT_COOKIE)?.value ??
      "/app",
  );
  cookieStore.delete(AUTH_NEXT_COOKIE);

  if (!code) {
    return NextResponse.redirect(
      new URL("/login?error=missing_code", requestUrl),
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[auth] code exchange failed:", error.name, error.message);
    return NextResponse.redirect(
      new URL("/login?error=callback_failed", requestUrl),
    );
  }

  return NextResponse.redirect(new URL(next, requestUrl));
}
