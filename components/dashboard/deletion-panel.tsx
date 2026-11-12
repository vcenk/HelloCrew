"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";

import {
  getWorkspaceDeletion,
  requestWorkspaceDeletion,
  type DeletionSnapshot,
} from "@/app/app/deletion-actions";

import { Button, Panel, Pill } from "./ui";

/**
 * Leaving.
 *
 * A pilot business must be able to take its data out of this system, and
 * must be able to see how far that got rather than be told "probably
 * finished". Two gates before anything happens: only an owner sees this
 * panel at all, and the workspace's own name has to be typed.
 *
 * Nothing here claims compliance with any named regulation. It says what it
 * does: it removes this workspace's data from this system.
 */
export function DeletionPanel() {
  const [snapshot, setSnapshot] = useState<DeletionSnapshot | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getWorkspaceDeletion().then(
      (result) => {
        if (!cancelled) setSnapshot(result);
      },
      () => {
        if (!cancelled) setSnapshot({ state: "signed_out" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Hidden entirely unless this is an owner with a workspace. There is
  // nothing useful here for anyone else, and a delete button shown to
  // someone who cannot use it is just alarming.
  if (
    !snapshot ||
    snapshot.state === "unavailable" ||
    snapshot.state === "signed_out" ||
    snapshot.state === "not_owner"
  )
    return null;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const result = await requestWorkspaceDeletion(typed);
      if (result.ok) {
        setTyped("");
        setSnapshot(await getWorkspaceDeletion());
      } else if (result.reason === "mismatch") {
        setError("That doesn’t match the workspace name.");
      } else if (result.reason === "not_owner") {
        setError("Only the workspace owner can do this.");
      } else {
        setError("Couldn’t record the request. Nothing was deleted.");
      }
    } catch {
      setError("Couldn’t record the request. Nothing was deleted.");
    } finally {
      setBusy(false);
    }
  }

  if (snapshot.state === "none") {
    const ready = typed.trim() === snapshot.workspaceName.trim();
    return (
      <Panel
        title="Delete this workspace"
        className="danger-zone"
        actions={
          <Pill tone="attention">
            <AlertTriangle size={13} aria-hidden="true" /> Permanent
          </Pill>
        }
      >
        <p className="danger-note">
          This removes your conversations, customers, appointments, knowledge,
          uploaded files, workflows and connections from HelloCrew. Your widget
          stops answering. It cannot be undone, and we keep no copy — only a
          record that the deletion happened and how many rows it cleared.
        </p>
        <label className="danger-confirm">
          <span>
            Type <strong>{snapshot.workspaceName}</strong> to confirm
          </span>
          <input
            type="text"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={snapshot.workspaceName}
            autoComplete="off"
            spellCheck={false}
            aria-label="Workspace name"
          />
        </label>
        {error && (
          <p className="danger-error" role="alert">
            {error}
          </p>
        )}
        <Button
          variant="danger"
          icon={Trash2}
          disabled={!ready || busy}
          onClick={() => void confirm()}
        >
          {busy ? "Recording…" : "Delete this workspace"}
        </Button>
      </Panel>
    );
  }

  const { stepsDone, stepsTotal, removed, lastError } = snapshot;
  return (
    <Panel
      title="Deleting this workspace"
      className="danger-zone"
      actions={
        <Pill tone={snapshot.state === "failed" ? "attention" : "neutral"}>
          {snapshot.state === "completed"
            ? "Done"
            : snapshot.state === "failed"
              ? "Stopped"
              : "In progress"}
        </Pill>
      }
    >
      <p className="danger-note">
        {snapshot.state === "completed"
          ? `Finished. ${removed} rows were removed across ${stepsTotal} steps.`
          : snapshot.state === "failed"
            ? `Stopped after ${stepsDone} of ${stepsTotal} steps, with ${removed} rows removed. It will be retried.`
            : `Step ${stepsDone} of ${stepsTotal}, ${removed} rows removed so far. This runs in the background and continues if it is interrupted.`}
      </p>
      {lastError && (
        <p className="danger-error" role="alert">
          Last error: {lastError}
        </p>
      )}
    </Panel>
  );
}
