"use client";

import { useState } from "react";
import { AlertTriangle, Check, CopyCheck, ExternalLink, Undo2 } from "lucide-react";

import type {
  ActionProposal,
  ActionResult,
  ChangeOperation,
} from "@/lib/copilot/contracts";
import { Button, Pill } from "@/components/dashboard/ui";

/**
 * The cards an owner decides on.
 *
 * Presentation only: what may be changed, and whether it is live, is settled
 * on the server before any of this renders. Nothing here can approve
 * anything — it collects a decision and hands it back.
 */

const stateTone: Record<
  ActionResult["status"],
  "neutral" | "success" | "attention" | "info"
> = {
  applied: "success",
  draft: "info",
  partial: "attention",
  rejected: "neutral",
  failed: "attention",
};

function OperationRow({
  operation,
  checked,
  onToggle,
  onEdit,
}: {
  operation: ChangeOperation;
  checked: boolean;
  onToggle: (next: boolean) => void;
  onEdit: (content: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(operation.after ?? "");

  return (
    <li className="copilot-op" data-conflict={Boolean(operation.conflict)}>
      <label className="copilot-op-head">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onToggle(event.target.checked)}
        />
        <span className="copilot-op-title">{operation.title}</span>
        {operation.duplicate && <Pill tone="neutral">Already there</Pill>}
        {operation.conflict && <Pill tone="attention">Disagrees</Pill>}
      </label>

      {operation.before && (
        <p className="copilot-op-before">
          <span>Now</span> {operation.before}
        </p>
      )}

      {editing ? (
        <textarea
          className="copilot-op-edit"
          rows={3}
          value={draft}
          aria-label={`Edit ${operation.title}`}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            onEdit(draft);
            setEditing(false);
          }}
        />
      ) : (
        <p className="copilot-op-after">{operation.after}</p>
      )}

      {operation.conflict && (
        <p className="copilot-op-conflict">
          <AlertTriangle size={13} aria-hidden="true" />{" "}
          {operation.conflict.explanation}
        </p>
      )}

      {!editing && (
        <button
          type="button"
          className="copilot-op-editlink"
          onClick={() => setEditing(true)}
        >
          Edit
        </button>
      )}
    </li>
  );
}

export function ProposalCard({
  proposal,
  busy,
  onApply,
  onDiscard,
}: {
  proposal: ActionProposal;
  busy: boolean;
  onApply: (
    operationIds: string[],
    edits: Record<string, { content?: string }>,
  ) => void;
  onDiscard: () => void;
}) {
  const { changes } = proposal;
  const [kept, setKept] = useState<Set<string>>(
    () =>
      new Set(
        changes.operations
          .filter((operation) => operation.selected)
          .map((operation) => operation.id),
      ),
  );
  const [edits, setEdits] = useState<Record<string, { content?: string }>>({});

  const toggle = (id: string, next: boolean) =>
    setKept((current) => {
      const copy = new Set(current);
      if (next) copy.add(id);
      else copy.delete(id);
      return copy;
    });

  return (
    <section className="copilot-card" aria-label={changes.title}>
      <header className="copilot-card-head">
        <strong>{changes.title}</strong>
        {/*
          Said on the card itself rather than left to anyone's memory: a draft
          is not something a customer can be told.
        */}
        <Pill tone={changes.affectsLiveBehaviour ? "attention" : "neutral"}>
          {changes.affectsLiveBehaviour ? "Changes live behaviour" : "Draft only"}
        </Pill>
      </header>

      <p className="copilot-card-summary">{changes.summary}</p>

      {changes.notes.map((note) => (
        <p className="copilot-card-note" key={note}>
          {note}
        </p>
      ))}

      {changes.operations.length > 0 && (
        <>
          <ul className="copilot-ops">
            {changes.operations.map((operation) => (
              <OperationRow
                key={operation.id}
                operation={operation}
                checked={kept.has(operation.id)}
                onToggle={(next) => toggle(operation.id, next)}
                onEdit={(content) =>
                  setEdits((current) => ({
                    ...current,
                    [operation.id]: { content },
                  }))
                }
              />
            ))}
          </ul>

          <div className="copilot-card-actions">
            <Button
              variant="primary"
              size="sm"
              icon={Check}
              disabled={busy || kept.size === 0}
              onClick={() => onApply([...kept], edits)}
            >
              {busy
                ? "Adding…"
                : `Add ${kept.size} as draft${kept.size === 1 ? "" : "s"}`}
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                setKept(new Set(changes.operations.map((o) => o.id)))
              }
            >
              <CopyCheck size={15} aria-hidden="true" /> Select all
            </Button>
            <Button size="sm" disabled={busy} onClick={onDiscard}>
              Discard
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

export function ResultCard({
  result,
  busy,
  onUndo,
  onApprove,
}: {
  result: ActionResult;
  busy: boolean;
  onUndo?: () => void;
  onApprove?: () => void;
}) {
  return (
    <section className="copilot-card" aria-label="What changed">
      <header className="copilot-card-head">
        <strong>{result.status === "failed" ? "Nothing changed" : "Done"}</strong>
        <Pill tone={stateTone[result.status]}>{result.status}</Pill>
      </header>

      <p className="copilot-card-summary">{result.summary}</p>
      {result.error && <p className="copilot-card-note">{result.error}</p>}

      <div className="copilot-card-actions">
        {result.links.map((link) => (
          <a className="copilot-link" key={link.href} href={link.href}>
            {link.label} <ExternalLink size={13} aria-hidden="true" />
          </a>
        ))}
        {/*
          Approving is a separate, confirmed step. Reading a document never
          puts words in the crew's mouth.
        */}
        {onApprove && result.applied > 0 && (
          <Button variant="primary" size="sm" disabled={busy} onClick={onApprove}>
            Approve {result.applied} for the crew
          </Button>
        )}
        {onUndo && result.undo && (
          <Button size="sm" icon={Undo2} disabled={busy} onClick={onUndo}>
            Undo
          </Button>
        )}
      </div>
    </section>
  );
}
