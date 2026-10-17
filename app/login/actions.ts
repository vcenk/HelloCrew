"use server";

import { redirect } from "next/navigation";

import { getSiteUrl, safeNextPath } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export async function signInWithGoogle(formData?: FormData) {
  const nextValue = formData?.get("next");
  const next = safeNextPath(typeof nextValue === "string" ? nextValue : "/app");
  const supabase = await createClient();
  const callback = new URL("/auth/callback", getSiteUrl());
  callback.searchParams.set("next", next);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callback.toString(),
      queryParams: { prompt: "select_account" },
    },
  });

  if (error || !data.url) redirect("/login?error=oauth_start_failed");
  redirect(data.url);
}
