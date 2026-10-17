"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  AUTH_NEXT_COOKIE,
  getSiteUrl,
  safeNextPath,
} from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export async function signInWithGoogle(formData?: FormData) {
  const nextValue = formData?.get("next");
  const next = safeNextPath(typeof nextValue === "string" ? nextValue : "/app");

  // Keep the return path in a short-lived cookie so the OAuth redirect URL is
  // exactly /auth/callback. Supabase only honours allow-listed redirect URLs,
  // and an extra query string would make it fall back to the Site URL.
  (await cookies()).set(AUTH_NEXT_COOKIE, next, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: new URL("/auth/callback", getSiteUrl()).toString(),
      queryParams: { prompt: "select_account" },
    },
  });

  if (error || !data.url) redirect("/login?error=oauth_start_failed");
  redirect(data.url);
}
