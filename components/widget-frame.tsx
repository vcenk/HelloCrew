"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  LoaderCircle,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

import type { WidgetChatMessage, WidgetInstallation } from "@/lib/widget";
import styles from "./widget-frame.module.css";

type Message = {
  id: string;
  role: "visitor" | "assistant" | "owner";
  text: string;
  source?: string;
};

type Session = { id: string; token: string; lastAt: string };

const POLL_MS = 4000;

function notifyParent(open: boolean) {
  let targetOrigin = "*";
  try {
    if (document.referrer) targetOrigin = new URL(document.referrer).origin;
  } catch {
    targetOrigin = "*";
  }
  window.parent.postMessage({ source: "hellocrew-widget", type: "resize", open }, targetOrigin);
}

function storageKey(id: string) {
  return `hellocrew:widget:${id}`;
}
function readSession(id: string): Session | null {
  try {
    const raw = localStorage.getItem(storageKey(id));
    const parsed = raw ? (JSON.parse(raw) as Session) : null;
    return parsed?.id && parsed.token ? parsed : null;
  } catch {
    return null;
  }
}
function writeSession(id: string, session: Session | null) {
  try {
    if (session) localStorage.setItem(storageKey(id), JSON.stringify(session));
    else localStorage.removeItem(storageKey(id));
  } catch {
    /* storage blocked: the chat still works until the page closes */
  }
}

function fromServer(m: WidgetChatMessage): Message {
  return { id: m.id, role: m.role === "customer" ? "visitor" : m.role, text: m.text };
}

export function WidgetFrame({ installation }: { installation: WidgetInstallation }) {
  const workspace = installation.mode === "workspace";
  const greeting: Message = { id: "greeting", role: "assistant", text: installation.identity.greeting };
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [messages, setMessages] = useState<Message[]>([greeting]);
  const session = useRef<Session | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const limit = workspace ? 60 : 13;

  useEffect(() => notifyParent(open), [open]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, busy]);

  const merge = useCallback((incoming: WidgetChatMessage[]) => {
    if (incoming.length === 0) return;
    setMessages((current) => {
      const known = new Set(current.map((m) => m.id));
      const fresh = incoming.filter((m) => !known.has(m.id)).map(fromServer);
      return fresh.length ? [...current, ...fresh] : current;
    });
    const last = Math.max(...incoming.map((m) => Date.parse(m.at)));
    if (session.current && last > Date.parse(session.current.lastAt)) {
      session.current = { ...session.current, lastAt: new Date(last).toISOString() };
      writeSession(installation.id, session.current);
    }
  }, [installation.id]);

  // Fetch messages added since we last looked (owner replies, decisions).
  const poll = useCallback(
    async (from?: string) => {
      const s = session.current;
      if (!workspace || !s) return;
      const params = new URLSearchParams({
        installationId: installation.id,
        conversationId: s.id,
        token: s.token,
        after: from ?? s.lastAt,
      });
      const response = await fetch(`/api/widget/chat?${params}`).catch(() => null);
      if (!response) return;
      if (response.status === 410) {
        session.current = null;
        writeSession(installation.id, null);
        return;
      }
      if (!response.ok) return;
      const result = (await response.json()) as { messages: WidgetChatMessage[]; waitingForPerson: boolean };
      merge(result.messages);
      setWaiting(result.waitingForPerson);
    },
    [installation.id, merge, workspace],
  );

  // Restore this visitor's earlier chat when the window opens.
  useEffect(() => {
    if (!workspace || !open || session.current) return;
    const stored = readSession(installation.id);
    if (!stored) return;
    session.current = stored;
    void poll("1970-01-01T00:00:00Z");
  }, [installation.id, open, poll, workspace]);

  useEffect(() => {
    if (!workspace || !open) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [open, poll, workspace]);

  async function sendMessage(message: string) {
    const clean = message.trim();
    if (!clean || busy || messages.length >= limit) return;
    setBusy(true);
    setError("");
    setDraft("");
    const pendingId = crypto.randomUUID();
    setMessages((current) => [...current, { id: pendingId, role: "visitor", text: clean }]);

    try {
      if (!workspace) {
        const response = await fetch("/api/widget/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ installationId: installation.id, message: clean }),
        });
        const result = (await response.json()) as { reply?: string; source?: string; error?: string };
        if (!response.ok || !result.reply) throw new Error(result.error ?? "The practice reply did not finish.");
        setMessages((current) => [
          ...current,
          { id: crypto.randomUUID(), role: "assistant", text: result.reply!, source: result.source },
        ]);
        return;
      }

      const s = session.current;
      const response = await fetch("/api/widget/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installationId: installation.id,
          conversation: s ? { id: s.id, token: s.token } : undefined,
          message: clean,
        }),
      });
      const result = (await response.json()) as {
        conversation?: { id: string; token?: string };
        customer?: { id: string; at: string };
        replies?: WidgetChatMessage[];
        waitingForPerson?: boolean;
        error?: string;
        code?: string;
      };
      if (response.status === 410) {
        session.current = null;
        writeSession(installation.id, null);
      }
      if (!response.ok || !result.conversation) throw new Error(result.error ?? "Your message didn’t send. Try again.");
      if (result.conversation.token)
        session.current = { id: result.conversation.id, token: result.conversation.token, lastAt: new Date().toISOString() };
      if (session.current) writeSession(installation.id, session.current);
      // Swap the temporary id for the stored one so polling can't repeat it.
      if (result.customer)
        setMessages((current) => current.map((m) => (m.id === pendingId ? { ...m, id: result.customer!.id } : m)));
      merge([...(result.customer ? [{ ...result.customer, role: "customer" as const, text: clean }] : []), ...(result.replies ?? [])]);
      setWaiting(Boolean(result.waitingForPerson));
    } catch (caught) {
      setMessages((current) => current.filter((m) => m.id !== pendingId));
      setDraft(clean);
      setError(caught instanceof Error ? caught.message : "Your message didn’t send. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.root} data-widget-open={open}>
      {open ? (
        <section className={styles.panel} aria-label={workspace ? "Website chat" : "Website chat practice"}>
          <header className={styles.header}>
            <span className={styles.avatar}>
              <Sparkles size={18} aria-hidden="true" />
            </span>
            <div>
              <strong>{installation.identity.name}</strong>
              <small>{installation.business.name}</small>
            </div>
            <button type="button" aria-label="Close chat" onClick={() => setOpen(false)}>
              <X size={18} />
            </button>
          </header>

          <div className={styles.practiceBanner}>
            <ShieldCheck size={14} />
            {workspace
              ? "Answers come from this business’s approved information."
              : "Public practice widget · no live AI or real messages"}
          </div>

          <div className={styles.timeline} aria-live="polite">
            {messages.map((message) => (
              <article
                className={`${styles.message} ${styles[message.role === "owner" ? "assistant" : message.role]}`}
                key={message.id}
              >
                {message.role === "owner" && <small className={styles.author}>Team</small>}
                <p>{message.text}</p>
                {message.source ? <small>Source: {message.source}</small> : null}
              </article>
            ))}
            {busy ? (
              <div className={styles.thinking} role="status">
                <LoaderCircle className={styles.spin} size={15} />
                {workspace ? "Typing…" : "Checking approved practice facts…"}
              </div>
            ) : null}
            {waiting && !busy ? (
              <div className={styles.thinking} role="status">
                A team member will reply here.
              </div>
            ) : null}
            <div ref={end} />
          </div>

          {messages.length === 1 ? (
            <div className={styles.suggestions}>
              {installation.suggestedQuestions.map((question) => (
                <button type="button" key={question} disabled={busy} onClick={() => void sendMessage(question)}>
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
            <label htmlFor="widget-message">{workspace ? "Your message" : "Ask a practice question"}</label>
            <div>
              <input
                id="widget-message"
                maxLength={workspace ? 1000 : 500}
                placeholder="Type your question…"
                value={draft}
                disabled={busy || messages.length >= limit}
                onChange={(event) => setDraft(event.target.value)}
              />
              <button
                type="submit"
                aria-label={workspace ? "Send message" : "Send practice question"}
                disabled={busy || !draft.trim() || messages.length >= limit}
              >
                <ArrowUp size={17} />
              </button>
            </div>
          </form>

          <footer>
            <span>HelloCrew</span>
            <span>{workspace ? "AI receptionist" : "Practice engine"}</span>
          </footer>
        </section>
      ) : (
        <button type="button" className={styles.launcher} aria-label="Open website chat" onClick={() => setOpen(true)}>
          <MessageCircle size={24} />
          <span>{workspace ? "Chat" : "Practice"}</span>
        </button>
      )}
    </main>
  );
}
