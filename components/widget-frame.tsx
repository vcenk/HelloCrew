"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  LoaderCircle,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

import type { WidgetInstallation } from "@/lib/widget";
import styles from "./widget-frame.module.css";

type WidgetMessage = {
  id: string;
  role: "visitor" | "assistant";
  text: string;
  source?: string;
};

type WidgetReply = {
  reply?: string;
  source?: string;
  error?: string;
};

function notifyParent(open: boolean) {
  let targetOrigin = "*";
  try {
    if (document.referrer) targetOrigin = new URL(document.referrer).origin;
  } catch {
    targetOrigin = "*";
  }
  window.parent.postMessage(
    { source: "hellocrew-widget", type: "resize", open },
    targetOrigin,
  );
}

export function WidgetFrame({
  installation,
}: {
  installation: WidgetInstallation;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<WidgetMessage[]>([
    {
      id: "greeting",
      role: "assistant",
      text: installation.identity.greeting,
    },
  ]);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    notifyParent(open);
  }, [open]);

  async function sendMessage(message: string) {
    const clean = message.trim();
    if (!clean || busy || messages.length >= 13) return;

    setBusy(true);
    setError("");
    setDraft("");
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "visitor", text: clean },
    ]);

    try {
      const response = await fetch("/api/widget/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installationId: installation.id,
          message: clean,
        }),
      });
      const result = (await response.json()) as WidgetReply;
      if (!response.ok || !result.reply)
        throw new Error(result.error ?? "The practice reply did not finish.");
      const reply = result.reply;

      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: reply,
          source: result.source,
        },
      ]);
      window.setTimeout(
        () => end.current?.scrollIntoView({ behavior: "smooth" }),
        50,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The practice widget could not reply.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.root} data-widget-open={open}>
      {open ? (
        <section className={styles.panel} aria-label="Website chat practice">
          <header className={styles.header}>
            <span className={styles.avatar}>
              <Sparkles size={18} aria-hidden="true" />
            </span>
            <div>
              <strong>{installation.identity.name}</strong>
              <small>{installation.business.name}</small>
            </div>
            <button
              type="button"
              aria-label="Close chat"
              onClick={() => setOpen(false)}
            >
              <X size={18} />
            </button>
          </header>

          <div className={styles.practiceBanner}>
            <ShieldCheck size={14} />
            Public practice widget · no live AI or real messages
          </div>

          <div className={styles.timeline} aria-live="polite">
            {messages.map((message) => (
              <article
                className={`${styles.message} ${styles[message.role]}`}
                key={message.id}
              >
                <p>{message.text}</p>
                {message.source ? (
                  <small>Source: {message.source}</small>
                ) : null}
              </article>
            ))}
            {busy ? (
              <div className={styles.thinking} role="status">
                <LoaderCircle className={styles.spin} size={15} /> Checking
                approved practice facts…
              </div>
            ) : null}
            <div ref={end} />
          </div>

          {messages.length === 1 ? (
            <div className={styles.suggestions}>
              {installation.suggestedQuestions.map((question) => (
                <button
                  type="button"
                  key={question}
                  disabled={busy}
                  onClick={() => void sendMessage(question)}
                >
                  {question}
                </button>
              ))}
            </div>
          ) : null}

          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}

          <form
            className={styles.composer}
            onSubmit={(event) => {
              event.preventDefault();
              void sendMessage(draft);
            }}
          >
            <label htmlFor="widget-message">Ask a practice question</label>
            <div>
              <input
                id="widget-message"
                maxLength={500}
                placeholder="Type your question…"
                value={draft}
                disabled={busy || messages.length >= 13}
                onChange={(event) => setDraft(event.target.value)}
              />
              <button
                type="submit"
                aria-label="Send practice question"
                disabled={busy || !draft.trim() || messages.length >= 13}
              >
                <ArrowUp size={17} />
              </button>
            </div>
          </form>

          <footer>
            <span>HelloCrew</span>
            <span>Practice engine</span>
          </footer>
        </section>
      ) : (
        <button
          type="button"
          className={styles.launcher}
          aria-label="Open website chat"
          onClick={() => setOpen(true)}
        >
          <MessageCircle size={24} />
          <span>Practice</span>
        </button>
      )}
    </main>
  );
}
