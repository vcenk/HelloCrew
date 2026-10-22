"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ArrowLeft, RotateCcw, TriangleAlert } from "lucide-react";

import styles from "./error.module.css";

// Covers the marketing, auth and widget-test routes. The dashboard has its
// own boundary at app/app/error.tsx so a failing page keeps the shell.
export default function RootError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className={styles.shell}>
      <div className={styles.card} role="alert">
        <span className={styles.icon}>
          <TriangleAlert size={21} aria-hidden="true" />
        </span>
        <h1>That page took a wrong turn.</h1>
        <p>
          Nothing you saved is affected. Try again — if it keeps happening, head
          back to the start and pick it up from there.
        </p>
        {error.digest && (
          <p className={styles.digest}>Reference: {error.digest}</p>
        )}
        <div className={styles.actions}>
          <button type="button" onClick={() => retry()}>
            <RotateCcw size={17} aria-hidden="true" /> Try again
          </button>
          <Link href="/">
            <ArrowLeft size={17} aria-hidden="true" /> Back to the start
          </Link>
        </div>
      </div>
    </main>
  );
}
