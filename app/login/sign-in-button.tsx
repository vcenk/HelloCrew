"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";

export function SignInButton() {
  const { pending } = useFormStatus();

  return (
    <button
      className="button dark auth-submit"
      type="submit"
      disabled={pending}
      aria-disabled={pending}
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
  );
}
