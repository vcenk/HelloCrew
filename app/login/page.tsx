import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Check, ShieldCheck, Sparkles } from "lucide-react";
import { redirect } from "next/navigation";

import { Brand, Buddy } from "@/components/brand";
import { safeNextPath } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

import { signInWithGoogle } from "./actions";
import { SignInButton } from "./sign-in-button";

export const metadata: Metadata = {
  title: "Sign in · HelloCrew",
  description:
    "Sign in to save your HelloCrew receptionist, knowledge and conversations to a private workspace.",
};

const errorMessages: Record<string, string> = {
  missing_code: "Google did not return a sign-in code. Please try again.",
  callback_failed: "We could not finish that sign-in. Please try again.",
  provider_failed:
    "Google sign-in failed on our side. Please try again in a minute; if it keeps happening, the Google settings need checking.",
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
    <main className="auth-shell" id="main-content">
      <a className="skip-link" href="#auth-card">
        Skip to sign in
      </a>
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
            Bring your receptionist, trusted answers and customer conversations
            together in one private workspace.
          </p>
          <ul
            className="auth-benefits"
            aria-label="What your workspace includes"
          >
            <li>
              <Check size={16} aria-hidden="true" /> Pick up your setup on any
              device
            </li>
            <li>
              <Check size={16} aria-hidden="true" /> Keep business knowledge
              private by default
            </li>
            <li>
              <Check size={16} aria-hidden="true" /> Stay in control before
              anything goes live
            </li>
          </ul>
        </div>
        <div className="auth-buddy" aria-hidden="true">
          <Buddy />
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card" id="auth-card" tabIndex={-1}>
          <span className="auth-icon">
            <Sparkles size={22} aria-hidden="true" />
          </span>
          <span className="auth-kicker">Your owner workspace</span>
          <h2>Welcome in.</h2>
          <p>
            Continue with Google to save your setup securely. New here? We’ll
            create your workspace as you sign in.
          </p>
          {error && errorMessages[error] ? (
            <div className="auth-error" role="alert">
              {errorMessages[error]}
            </div>
          ) : null}
          <form action={signInWithGoogle}>
            <input type="hidden" name="next" value={next} />
            <SignInButton />
          </form>
          <p className="auth-helper">
            One secure sign-in. No separate HelloCrew password to remember.
          </p>
          <div className="auth-trust">
            <ShieldCheck size={18} aria-hidden="true" />
            <span>
              Your session is securely verified and each workspace is kept
              separate from every other business.
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
