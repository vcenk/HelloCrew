import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  CloudOff,
  MonitorSmartphone,
  Plug,
  Save,
  ShieldCheck,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { redirect } from "next/navigation";

import { Brand, Buddy } from "@/components/brand";
import { LegalFooter } from "@/components/legal-page";
import { safeNextPath } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

import { signInWithGoogle } from "./actions";
import { SignInButton } from "./sign-in-button";

export const metadata: Metadata = {
  title: "Sign in · HelloCrew",
  description:
    "Sign in with Google to keep your HelloCrew crew in a private cloud workspace, reach it from any device, connect customer channels and turn on Live AI.",
  // A sign-in page has nothing useful to index.
  robots: { index: false, follow: false },
};

// Deliberately vague about causes: an owner can only retry, and the specific
// provider or configuration fault is in the server log, not on screen.
const errorMessages: Record<string, string> = {
  missing_code: "Google didn’t finish that sign-in. Please try again.",
  callback_failed: "We couldn’t finish that sign-in. Please try again.",
  provider_failed:
    "Google sign-in isn’t working right now. Please try again in a minute.",
  oauth_start_failed: "Google sign-in couldn’t start. Please try again.",
};
const genericError = "Something interrupted that sign-in. Please try again.";

const reasons = [
  {
    icon: Save,
    title: "Kept in your workspace",
    body: "Your crew, answers and conversations live in a private cloud workspace instead of one browser.",
  },
  {
    icon: MonitorSmartphone,
    title: "On any device",
    body: "Set it up on a laptop, check it on your phone between customers.",
  },
  {
    icon: Plug,
    title: "Real channels",
    body: "Website chat, Messenger and Instagram, WhatsApp and Google reviews all need an account to connect.",
  },
  {
    icon: Zap,
    title: "Live AI",
    body: "Switch from saved answers to live replies, inside a monthly budget you set.",
  },
];

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

  const message = error
    ? (errorMessages[error] ?? genericError)
    : null;

  return (
    <>
      <a className="skip-link" href="#auth-card">
        Skip to sign in
      </a>
      <main className="auth-shell" id="main-content">
        <section className="auth-story" aria-labelledby="auth-story-heading">
          <Link href="/" className="auth-brand" aria-label="HelloCrew home">
            <Brand />
          </Link>
          <div className="auth-story-copy">
            <span className="eyebrow">WHY AN ACCOUNT</span>
            <h1 id="auth-story-heading">
              Somewhere permanent
              <br />
              <span className="serif">for your crew.</span>
            </h1>
            <p>
              Practice works without an account. Signing in is what gives the
              crew a home, and is what real channels and Live AI need.
            </p>
            <ul className="auth-reasons" aria-label="What an account adds">
              {reasons.map((reason) => (
                <li key={reason.title}>
                  <span className="auth-reason-icon" aria-hidden="true">
                    <reason.icon size={17} />
                  </span>
                  <div>
                    <strong>{reason.title}</strong>
                    <span>{reason.body}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="auth-buddy" aria-hidden="true">
            <Buddy />
          </div>
        </section>

        <section className="auth-panel" aria-labelledby="auth-card-heading">
          <div className="auth-card" id="auth-card" tabIndex={-1}>
            <span className="auth-icon" aria-hidden="true">
              <ShieldCheck size={22} />
            </span>
            <span className="auth-kicker">Owner sign-in</span>
            <h2 id="auth-card-heading">Welcome in.</h2>
            <p>
              Continue with Google. If you’re new, your workspace is created as
              you sign in.
            </p>

            {message ? (
              // role=alert so it is announced on arrival; the icon means the
              // red tint is not the only signal.
              <div className="auth-error" role="alert">
                <TriangleAlert size={17} aria-hidden="true" />
                <span>{message}</span>
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
              <Check size={17} aria-hidden="true" />
              <span>
                Each workspace is kept separate from every other business, and
                your business knowledge stays private by default.
              </span>
            </div>

            <div className="auth-practice">
              <p>
                <CloudOff size={15} aria-hidden="true" /> Nothing from the
                practice studio has left your browser yet. The first time you
                sign in, that browser’s setup becomes your new workspace’s
                starting point.
              </p>
              <Link className="auth-back" href="/app">
                <ArrowLeft size={16} aria-hidden="true" /> Back to the practice
                studio
              </Link>
            </div>
          </div>
        </section>
      </main>
      <LegalFooter />
    </>
  );
}
