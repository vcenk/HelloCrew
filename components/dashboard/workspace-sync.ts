"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  loadWorkspace,
  saveWorkspaceDocument,
  type WorkspaceSnapshot,
} from "@/app/app/actions";
import {
  LOCAL_WRITE_EVENT,
  localStorageKeyFor,
  workspaceDocumentKeys,
  type WorkspaceDocumentKey,
} from "@/lib/workspace-documents";

export type Account =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "signed_out" }
  | {
      status: "signed_in";
      email: string | null;
      workspaceName: string;
      role: "owner" | "operator" | "viewer";
    };

export type SaveStatus = "idle" | "saving" | "saved" | "error" | "conflict";

const LOAD_TIMEOUT_MS = 6000;
const SAVE_DELAY_MS = 900;

// Key-order independent form: Postgres jsonb reorders object keys.
function canonical(raw: string | null): string | undefined {
  if (!raw) return undefined;
  try {
    const sort = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(sort)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.keys(value as Record<string, unknown>)
                .sort()
                .map((k) => [k, sort((value as Record<string, unknown>)[k])]),
            )
          : value;
    return JSON.stringify(sort(JSON.parse(raw)));
  } catch {
    return undefined;
  }
}

function readLocal(key: WorkspaceDocumentKey): string | null {
  try {
    return localStorage.getItem(localStorageKeyFor[key]);
  } catch {
    return null;
  }
}
function writeLocal(key: WorkspaceDocumentKey, value: unknown) {
  try {
    localStorage.setItem(localStorageKeyFor[key], JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

// Keeps the browser copy of each editor document in step with the signed-in
// workspace. Signed out (or Supabase not configured) it does nothing, and the
// dashboard keeps working from browser storage alone.
export function useWorkspaceSync(
  toast: (text: string, tone?: "success" | "info" | "error") => void,
) {
  const [account, setAccount] = useState<Account>({ status: "loading" });
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [ready, setReady] = useState(false);
  const versions = useRef<Partial<Record<WorkspaceDocumentKey, number>>>({});
  const synced = useRef<Partial<Record<WorkspaceDocumentKey, string>>>({});
  const dirty = useRef(new Set<WorkspaceDocumentKey>());
  const timer = useRef<number | null>(null);
  const flushing = useRef(false);
  const blocked = useRef(new Set<WorkspaceDocumentKey>());
  const canWrite = useRef(false);

  const flush = useCallback(async () => {
    if (flushing.current || !canWrite.current) return;
    flushing.current = true;
    let failed = false;
    try {
      while (dirty.current.size > 0) {
        const [key] = dirty.current;
        dirty.current.delete(key);
        if (blocked.current.has(key)) continue;
        const raw = readLocal(key);
        if (!raw || canonical(raw) === synced.current[key]) continue;
        let document: unknown;
        try {
          document = JSON.parse(raw);
        } catch {
          continue;
        }
        setSaveStatus("saving");
        const result = await saveWorkspaceDocument(
          key,
          versions.current[key] ?? 0,
          document,
        );
        if (result.ok) {
          versions.current[key] = result.version;
          synced.current[key] = canonical(raw);
          continue;
        }
        failed = true;
        if (result.reason === "conflict") {
          blocked.current.add(key);
          setSaveStatus("conflict");
          toast(
            "This workspace was changed somewhere else. Reload to get the latest version.",
            "error",
          );
          return;
        }
        if (result.reason === "signed_out") {
          canWrite.current = false;
          setAccount({ status: "signed_out" });
          toast("You were signed out. Changes stay in this browser.", "info");
          return;
        }
        // Keep the change queued so a later edit or retry sends it.
        dirty.current.add(key);
        setSaveStatus("error");
        return;
      }
      if (!failed) setSaveStatus((s) => (s === "saving" ? "saved" : s));
    } finally {
      flushing.current = false;
    }
  }, [toast]);

  const schedule = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
  }, [flush]);

  useEffect(() => {
    let cancelled = false;
    const timeout = new Promise<WorkspaceSnapshot>((resolve) =>
      window.setTimeout(
        () => resolve({ status: "unavailable" }),
        LOAD_TIMEOUT_MS,
      ),
    );
    Promise.race([
      loadWorkspace().catch(() => ({ status: "unavailable" }) as const),
      timeout,
    ])
      .then((snapshot) => {
        if (cancelled) return;
        if (snapshot.status !== "signed_in") {
          setAccount({ status: snapshot.status });
          return;
        }
        setAccount({
          status: "signed_in",
          email: snapshot.email,
          workspaceName: snapshot.workspaceName,
          role: snapshot.role,
        });
        canWrite.current = snapshot.role !== "viewer";
        for (const key of workspaceDocumentKeys) {
          const stored = snapshot.documents[key];
          if (stored) {
            // The workspace copy wins over whatever this browser had.
            writeLocal(key, stored.document);
            versions.current[key] = stored.version;
            synced.current[key] = canonical(readLocal(key));
          } else if (readLocal(key)) {
            // First sign-in on this browser: upload the local setup.
            dirty.current.add(key);
          }
        }
        if (dirty.current.size > 0) schedule();
        setSaveStatus("saved");
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [schedule]);

  useEffect(() => {
    const onWrite = (event: Event) => {
      const key = (event as CustomEvent<{ key: WorkspaceDocumentKey }>).detail
        ?.key;
      if (!key || !canWrite.current) return;
      dirty.current.add(key);
      schedule();
    };
    window.addEventListener(LOCAL_WRITE_EVENT, onWrite);
    return () => window.removeEventListener(LOCAL_WRITE_EVENT, onWrite);
  }, [schedule]);

  const retry = useCallback(() => {
    if (saveStatus === "conflict") {
      window.location.reload();
      return;
    }
    void flush();
  }, [flush, saveStatus]);

  return { account, saveStatus, ready, retry };
}
