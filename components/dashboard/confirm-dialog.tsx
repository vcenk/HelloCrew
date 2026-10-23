"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "./ui";

export type ConfirmRequest = {
  title: string;
  /** Name the exact thing being acted on, so the dialog is never ambiguous. */
  body: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  onConfirm: () => void | Promise<void>;
};

/**
 * One confirmation dialog for the whole dashboard: deleting a conversation,
 * discarding an edited draft, and anything else that cannot be undone.
 *
 * It closes through React rather than letting Escape close the <dialog>
 * natively, so the open flag and the element can never disagree — the same
 * trap that used to swallow a Ctrl+K in the command menu.
 */
export function ConfirmDialog({
  request,
  onClose,
}: {
  request: ConfirmRequest | null;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (request && !el.open) {
      setBusy(false);
      el.showModal();
      // Focus the safe option, not the destructive one.
      confirmButton.current?.focus();
    }
    if (!request && el.open) el.close();
  }, [request]);

  if (!request) {
    return (
      <dialog ref={dialog} className="ui-dialog" aria-hidden="true" />
    );
  }

  const run = async () => {
    // Guards against a double press while the server call is in flight.
    if (busy) return;
    setBusy(true);
    try {
      await request.onConfirm();
    } finally {
      onClose();
    }
  };

  return (
    <dialog
      ref={dialog}
      className="ui-dialog ui-confirm"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current && !busy) onClose();
      }}
    >
      <h2 id={titleId}>{request.title}</h2>
      <p id={bodyId}>{request.body}</p>
      <div className="ui-dialog-actions">
        <Button
          ref={confirmButton}
          variant="secondary"
          onClick={onClose}
          disabled={busy}
        >
          {request.cancelLabel ?? "Cancel"}
        </Button>
        <Button
          variant={request.tone === "danger" ? "danger" : "primary"}
          onClick={() => void run()}
          aria-disabled={busy}
          data-busy={busy}
        >
          {busy ? "Working…" : request.confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}

/**
 * Holds the pending confirmation plus the element that opened it, so focus
 * goes back where it came from whether the user confirms or cancels.
 */
export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const confirm = (next: ConfirmRequest) => {
    opener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setRequest(next);
  };

  const close = () => {
    setRequest(null);
    // After the dialog is gone, hand focus back to the trigger.
    const target = opener.current;
    opener.current = null;
    requestAnimationFrame(() => target?.focus());
  };

  return { request, confirm, close };
}
