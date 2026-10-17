import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabasePublicConfig, isSupabaseConfigured } from "./config";

export async function updateSession(request: NextRequest) {
  // If Supabase falls back to the Site URL (redirect URL not allow-listed), the
  // OAuth code lands on "/". Forward it to the callback so sign-in completes.
  const { pathname, searchParams } = request.nextUrl;
  if (pathname === "/" && searchParams.has("code")) {
    const callback = request.nextUrl.clone();
    callback.pathname = "/auth/callback";
    return NextResponse.redirect(callback);
  }
  let response = NextResponse.next({ request });
  // The public practice dashboard must keep working without Supabase configured.
  if (!isSupabaseConfigured()) return response;
  const { url, publishableKey } = getSupabasePublicConfig();
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([key, value]) =>
          response.headers.set(key, value),
        );
      },
    },
  });

  await supabase.auth.getClaims();
  return response;
}
