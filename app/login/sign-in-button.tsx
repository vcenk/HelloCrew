"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";

export function SignInButton() {
  const { pending } = useFormStatus();

  return (
    <>
      <button
        className="button dark auth-submit"
        type="submit"
        // aria-disabled rather than `disabled`, so the button keeps keyboard
        // focus while the redirect to Google is being prepared. The click
        // guard below is what actually stops a second submission.
        aria-disabled={pending}
        onClick={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <span className="google-mark" aria-hidden="true">
          G
        </span>
        <span>{pending ? "Opening Google…" : "Continue with Google"}</span>
        {pending ? (
          <LoaderCircle className="auth-spinner" size={18} aria-hidden="true" />
        ) : (
          <ArrowRight size={18} aria-hidden="true" />
        )}
      </button>
      {/* Announced to screen readers when the redirect starts; the button
          label alone changes too quietly to be noticed. */}
      <p className="auth-status" role="status" aria-live="polite">
        {pending ? "Taking you to Google to sign in…" : ""}
      </p>
    </>
  );
}
