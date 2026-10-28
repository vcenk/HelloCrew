"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { usePathname } from "next/navigation";
import { Paperclip, Send, Sparkles, X } from "lucide-react";

import {
  applyCopilotKnowledge,
  approveCopilotKnowledge,
  copilotTurn,
  undoCopilotKnowledge,
  type CopilotTurnResult,
} from "@/app/app/copilot-actions";
import { startKnowledgeUpload } from "@/app/app/knowledge-file-actions";
import type {
  ActionProposal,
  ActionResult,
  CopilotMessage,
} from "@/lib/copilot/contracts";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/dashboard/ui";
import { ProposalCard, ResultCard } from "./cards";

/**
 * The owner's Copilot: a conversational way to configure the business.
 *
 * Deliberately not the receptionist. This talks to the person who owns the
 * crew, and everything it proposes waits for them.
 */

const ACCEPT = ".pdf,.docx,.xlsx,.csv,.txt,.md";
const MAX_BYTES = 10 * 1024 * 1024;

/** Turns the route into the chip the owner sees, and a hint for the model. */
function contextFor(pathname: string) {
  const label =
    pathname.startsWith("/app/knowledge")
      ? "Knowledge"
      : pathname.startsWith("/app/conversations")
        ? "Conversations"
        : pathname.startsWith("/app/connections")
          ? "Connections"
          : pathname.startsWith("/app/crew")
            ? "Crew"
            : pathname.startsWith("/app/workflows")
              ? "Workflows"
              : "Today";
  return { route: pathname, label: `Owner · ${label}` };
}

const SUGGESTIONS = [
  "What do we already say about prices?",
  "Add this document to our knowledge",
];

type Pending = {
  proposal: ActionProposal;
  source: NonNullable<CopilotTurnResult["source"]>;
};

export function CopilotPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const titleId = useId();
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [attached, setAttached] = useState<{ id: string; name: string } | null>(
    null,
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  const say = useCallback((role: CopilotMessage["role"], body: string) => {
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role,
        text: body,
        at: Date.now(),
      },
    ]);
  }, []);

  // Focus moves into the panel when it opens, and Escape closes it.
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [messages, pending, result]);

  async function attach(file: File) {
    if (file.size > MAX_BYTES) {
      say("copilot", "Files can be up to 10 MB.");
      return;
    }
    setBusy(true);
    const start = await startKnowledgeUpload({
      fileName: file.name,
      sizeBytes: file.size,
    }).catch(() => null);
    if (!start?.ok) {
      setBusy(false);
      say("copilot", start?.error ?? "That upload couldn't be started.");
      return;
    }
    const { error } = await createClient()
      .storage.from("knowledge")
      .uploadToSignedUrl(start.path, start.token, file, {
        contentType: start.mimeType,
      });
    setBusy(false);
    if (error) {
      say("copilot", "The upload didn't finish. Try again.");
      return;
    }
    setAttached({ id: start.fileId, name: file.name });
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const asked = text.trim();
    if (!asked || busy) return;

    say("owner", attached ? `${asked}\n📎 ${attached.name}` : asked);
    setText("");
    setBusy(true);
    setResult(null);

    const answer = await copilotTurn({
      text: asked,
      context: contextFor(pathname),
      ...(attached ? { fileId: attached.id, fileName: attached.name } : {}),
    }).catch(() => null);
    setBusy(false);
    setAttached(null);

    if (!answer?.ok) {
      say("copilot", answer?.error ?? "Something went wrong.");
      return;
    }
    say("copilot", answer.reply);
    if (answer.proposal && answer.source)
      setPending({ proposal: answer.proposal, source: answer.source });
    if (answer.result) setResult(answer.result);
  }

  async function apply(
    operationIds: string[],
    edits: Record<string, { content?: string }>,
  ) {
    if (!pending) return;
    setBusy(true);
    const applied = await applyCopilotKnowledge({
      proposalId: pending.proposal.id,
      file: pending.source.file,
      suggestions: pending.source.suggestions,
      operationIds,
      edits,
    }).catch(() => null);
    setBusy(false);
    if (!applied?.ok) {
      say("copilot", applied?.error ?? "Those couldn't be added.");
      return;
    }
    setPending(null);
    setResult(applied.result);
    say("copilot", applied.result.summary);
  }

  async function approve() {
    if (!result?.undo) return;
    const ids = (JSON.parse(result.undo.token) as { ids?: string[] }).ids ?? [];
    if (ids.length === 0) return;
    setBusy(true);
    const approved = await approveCopilotKnowledge({ sourceIds: ids }).catch(
      () => null,
    );
    setBusy(false);
    if (!approved?.ok) {
      say("copilot", approved?.error ?? "Those couldn't be approved.");
      return;
    }
    setResult(approved.result);
    say("copilot", approved.result.summary);
  }

  async function undo() {
    if (!result?.undo) return;
    setBusy(true);
    const undone = await undoCopilotKnowledge({
      token: result.undo.token,
    }).catch(() => null);
    setBusy(false);
    if (!undone?.ok) {
      say("copilot", undone?.error ?? "That couldn't be undone.");
      return;
    }
    setResult(undone.result);
    say("copilot", undone.result.summary);
  }

  return (
    <aside
      className="copilot"
      data-open={open}
      aria-labelledby={titleId}
      aria-hidden={!open}
      inert={!open}
    >
      <header className="copilot-head">
        <span className="copilot-title" id={titleId}>
          <Sparkles size={16} aria-hidden="true" /> Copilot
        </span>
        <span className="copilot-chip">{contextFor(pathname).label}</span>
        <button
          ref={closeButton}
          type="button"
          className="dash-icon-button"
          onClick={onClose}
          aria-label="Close Copilot"
        >
          <X size={18} />
        </button>
      </header>

      <div className="copilot-log" ref={log} role="log" aria-live="polite">
        {messages.length === 0 && (
          <div className="copilot-empty">
            <p>
              Ask me to change how your crew works, or attach a document to add
              to your knowledge.
            </p>
            <ul className="copilot-suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <li key={suggestion}>
                  <button
                    type="button"
                    onClick={() => {
                      setText(suggestion);
                      composer.current?.focus();
                    }}
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {messages.map((message) => (
          <p className="copilot-msg" data-role={message.role} key={message.id}>
            {message.text}
          </p>
        ))}

        {pending && (
          <ProposalCard
            proposal={pending.proposal}
            busy={busy}
            onApply={apply}
            onDiscard={() => {
              setPending(null);
              say("copilot", "Discarded — nothing was added.");
            }}
          />
        )}

        {result && (
          <ResultCard
            result={result}
            busy={busy}
            onUndo={result.undo ? undo : undefined}
            onApprove={
              result.undo?.action === "knowledge_add_from_document"
                ? approve
                : undefined
            }
          />
        )}
      </div>

      <form className="copilot-composer" onSubmit={send}>
        {attached && (
          <p className="copilot-attached">
            <Paperclip size={13} aria-hidden="true" /> {attached.name}
            <button
              type="button"
              onClick={() => setAttached(null)}
              aria-label="Remove attachment"
            >
              <X size={13} />
            </button>
          </p>
        )}
        <textarea
          ref={composer}
          rows={2}
          value={text}
          placeholder="Ask the Copilot…"
          aria-label="Ask the Copilot"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(event);
            }
          }}
        />
        <div className="copilot-composer-actions">
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void attach(file);
              event.target.value = "";
            }}
          />
          <Button
            type="button"
            size="sm"
            icon={Paperclip}
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            Attach
          </Button>
          <Button
            type="submit"
            size="sm"
            variant="primary"
            icon={Send}
            disabled={busy || !text.trim()}
          >
            {busy ? "Working…" : "Send"}
          </Button>
        </div>
      </form>
    </aside>
  );
}
