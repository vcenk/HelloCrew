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

  // Supabase sends ?error=… when the provider step fails (for example a wrong
  // client secret in the Google provider settings).
  const providerError = requestUrl.searchParams.get("error");
  if (!code && providerError) {
    console.error(
      "[auth] provider error:",
      providerError,
      requestUrl.searchParams.get("error_description")?.slice(0, 300) ?? "",
    );
    return NextResponse.redirect(
      new URL("/login?error=provider_failed", requestUrl),
    );
  }

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
