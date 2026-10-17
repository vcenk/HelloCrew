import Link from "next/link";
import { ArrowLeft, ArrowRight, ShieldCheck, Sparkles } from "lucide-react";
import { redirect } from "next/navigation";

import { Brand, Buddy } from "@/components/brand";
import { safeNextPath } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

import { signInWithGoogle } from "./actions";

const errorMessages: Record<string, string> = {
  missing_code: "Google did not return a sign-in code. Please try again.",
  callback_failed: "We could not finish that sign-in. Please try again.",
  oauth_start_failed: "Google sign-in could not start. Please try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next: nextParam } = await searchParams;
  const next = safeNextPath(nextParam ?? "/app");
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims?.sub) redirect(next);

  return (
    <main className="auth-shell">
      <section className="auth-story" aria-label="HelloCrew introduction">
        <Link href="/" className="auth-brand">
          <Brand />
        </Link>
        <div className="auth-story-copy">
          <span className="eyebrow">YOUR REAL WORKSPACE STARTS HERE</span>
          <h1>
            A calm place for your
            <br />
            <span className="serif">helpful crew.</span>
          </h1>
          <p>
            Sign in to save your assistant, knowledge and workflows to your own
            workspace. The dashboard stays free to explore without an account.
          </p>
        </div>
        <div className="auth-buddy" aria-hidden="true">
          <Buddy />
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <span className="auth-icon">
            <Sparkles size={22} />
          </span>
          <h2>Welcome back.</h2>
          <p>Use your approved Google account to continue.</p>
          {error && errorMessages[error] ? (
            <div className="auth-error" role="alert">
              {errorMessages[error]}
            </div>
          ) : null}
          <form action={signInWithGoogle}>
            <input type="hidden" name="next" value={next} />
            <button className="button dark auth-submit" type="submit">
              Continue with Google <ArrowRight size={18} />
            </button>
          </form>
          <div className="auth-trust">
            <ShieldCheck size={18} />
            <span>
              Session cookies are verified by Supabase. Tenant data is protected
              with row-level security.
            </span>
          </div>
          <Link className="auth-back" href="/app">
            <ArrowLeft size={16} /> Keep exploring the practice studio
          </Link>
        </div>
      </section>
    </main>
  );
}
