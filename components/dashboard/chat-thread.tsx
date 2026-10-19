"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  BookOpen,
  CalendarCheck,
  CalendarDays,
  Calculator,
  GraduationCap,
  LoaderCircle,
  UserRound,
  Zap,
} from "lucide-react";

import { channelLabel } from "@/lib/conversations";
import type { Scenario } from "@/lib/demo";
import { MAX_PRACTICE_TURNS, useDashboard, type ChatMessage } from "./provider";
import { Pill } from "./ui";

export const UNANSWERED = "No matching information";

// Chips that show what a reply drew on, linking to where it can be changed.
function usedChips(message: ChatMessage) {
  const chips: { label: string; href: string; tone: "knowledge" | "skill" }[] =
    [];
  if (message.source && message.source !== UNANSWERED)
    chips.push({
      label: `Knowledge · ${message.source}`,
      href: "/app/knowledge",
      tone: "knowledge",
    });
  const labels = (message.activity ?? []).map((a) =>
    `${a.label} ${a.kind}`.toLowerCase(),
  );
  if (
    message.pendingId ||
    message.liveApprovals?.length ||
    labels.some((l) => l.includes("booking"))
  )
    chips.push({
      label: "Skill · Booking requests",
      href: "/app/crew/receptionist",
      tone: "skill",
    });
  if (labels.some((l) => l.includes("person") || l.includes("handoff")))
    chips.push({
      label: "Skill · Pass to a person",
      href: "/app/crew/receptionist",
      tone: "skill",
    });
  if (labels.some((l) => l.includes("saved a lead")))
    chips.push({ label: "Skill · Capture leads", href: "/app/crew/receptionist", tone: "skill" });
  if (message.engine === "live" && labels.some((l) => l.includes("searched")))
    chips.push({
      label: "Knowledge · searched",
      href: "/app/knowledge",
      tone: "knowledge",
    });
  return chips;
}

export function ChatThread({
  compact = false,
  selectedId,
  onSelect,
}: {
  compact?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const {
    identity,
    purpose,
    business,
    conversation,
    send,
    runScenario,
    decide,
    decideLive,
    engine,
    liveStatus,
    showActivity,
  } = useDashboard();
  const [draft, setDraft] = useState("");
  const [writeAs, setWriteAs] = useState<"customer" | "owner">("owner");
  // A real customer chat (website or messaging app): the owner can only
  // reply as the business.
  const website = conversation.channel !== "test";
  const human = conversation.mode === "human" || website;
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const turns = conversation.session?.turn ?? 0;
  const limitReached =
    engine === "practice" &&
    conversation.mode === "ai" &&
    turns >= MAX_PRACTICE_TURNS;

  const prompts: {
    id: Scenario;
    label: string;
    question: string;
    icon: typeof BookOpen;
  }[] = [
    {
      id: "hours",
      label: "Opening hours",
      question: "What are your opening hours?",
      icon: BookOpen,
    },
    {
      id: "quote",
      label: "A price",
      question: `How much is one ${business.services[0]?.name.toLowerCase() ?? "service"}?`,
      icon: Calculator,
    },
    {
      id: "booking",
      label: "Book a visit",
      question: "Can I book a visit this week?",
      icon: CalendarDays,
    },
    {
      id: "handoff",
      label: "Ask for a person",
      question: "Can I speak with a person?",
      icon: UserRound,
    },
  ];

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [conversation.messages.length, conversation.busy]);

  async function submit() {
    const text = draft;
    if (!text.trim() || conversation.busy || limitReached) return;
    setDraft("");
    const ok = await send(
      text,
      website ? "owner" : human && !compact ? writeAs : "customer",
    );
    if (!ok) setDraft(text);
    input.current?.focus();
  }

  const lastAssistant = [...conversation.messages]
    .reverse()
    .find((m) => m.role === "assistant");
  const selected = selectedId ?? lastAssistant?.id;

  return (
    <section
      className="thread"
      data-compact={compact}
      aria-label={`Test conversation with ${identity.name}`}
    >
      <header className="thread-head">
        <span className="dash-avatar" aria-hidden="true">
          {identity.name.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <strong>
            {compact
              ? `Try ${identity.name}`
              : website
                ? "Website visitor"
                : identity.name}
          </strong>
          <small>
            {compact
              ? "Uses your latest changes"
              : website
                ? `Chatting with ${identity.name} on ${conversation.channel === "website" ? "your website" : channelLabel[conversation.channel]}`
                : `${purpose.label} for ${business.name} · test chat`}
          </small>
        </div>
        {conversation.mode === "human" ? (
          <Pill tone="attention">You’re in the chat</Pill>
        ) : website ? (
          <Pill tone="info">{channelLabel[conversation.channel]}</Pill>
        ) : engine === "live" && liveStatus?.state === "ready" ? (
          <Pill tone="success">
            <Zap size={13} aria-hidden="true" /> Live AI
          </Pill>
        ) : (
          <Pill tone={limitReached ? "attention" : "neutral"}>
            Practice {turns}/{MAX_PRACTICE_TURNS}
          </Pill>
        )}
      </header>

      <div className="thread-body" aria-live="polite">
        {conversation.messages.length === 0 && (
          <div className="thread-intro">
            <span className="bubble bubble-assistant">{identity.greeting}</span>
            <p>Ask anything a customer might, or tap a prompt below.</p>
          </div>
        )}
        {conversation.messages.map((message, index) => {
          if (message.role === "customer")
            return (
              <div className="row row-customer" key={message.id}>
                <span className="bubble bubble-customer">{message.text}</span>
              </div>
            );
          if (message.role === "owner")
            return (
              <div className="row row-assistant row-owner" key={message.id}>
                <span className="row-author">You</span>
                <span className="bubble bubble-owner">{message.text}</span>
              </div>
            );
          const question = [...conversation.messages.slice(0, index)]
            .reverse()
            .find((m) => m.role === "customer")?.text;
          const approval = conversation.session?.approvals.find(
            (a) => a.id === message.pendingId,
          );
          const chips = usedChips(message);
          return (
            <div
              className="row row-assistant"
              data-selected={selected === message.id}
              key={message.id}
            >
              <button
                type="button"
                className="bubble bubble-assistant"
                onClick={() => onSelect?.(message.id)}
                aria-pressed={selected === message.id}
                aria-label={`${identity.name}: ${message.text}. Show how this reply was made`}
              >
                {message.text}
              </button>
              {chips.length > 0 && (
                <div className="row-used">
                  <span>Used</span>
                  {chips.map((chip) => (
                    <Link
                      key={chip.label}
                      href={chip.href}
                      className="used-chip"
                      data-tone={chip.tone}
                    >
                      {chip.label}
                    </Link>
                  ))}
                </div>
              )}
              {showActivity &&
                !compact &&
                message.activity &&
                message.activity.length > 0 && (
                  <div className="row-steps">
                    {message.activity.map((step, i) => (
                      <span key={i} data-kind={step.kind}>
                        {step.label}
                      </span>
                    ))}
                  </div>
                )}
              {message.source === UNANSWERED && question && (
                <div className="teach-callout">
                  <GraduationCap size={16} aria-hidden="true" />
                  <span>
                    Not in your knowledge yet. Teach it once and your whole crew
                    uses it.
                  </span>
                  <Link
                    className="ui-btn ui-btn-secondary ui-btn-sm"
                    href={`/app/knowledge?teach=${encodeURIComponent(question)}`}
                  >
                    Teach this answer
                  </Link>
                </div>
              )}
              {message.pendingId && approval && (
                <ApprovalCard
                  status={approval.status}
                  summary="Practice booking request. Nothing is booked for real."
                  busy={conversation.busy}
                  onDecide={(value) => void decide(message.pendingId!, value)}
                />
              )}
              {message.liveApprovals?.map((item) => (
                <ApprovalCard
                  key={item.id}
                  status={item.status}
                  summary={item.summary}
                  busy={conversation.busy}
                  onDecide={(value) => decideLive(message.id, item.id, value)}
                />
              ))}
            </div>
          );
        })}
        {conversation.busy && (
          <div className="thread-typing" role="status">
            <span />
            <span />
            <span />
            <span className="sr-only">{identity.name} is replying</span>
          </div>
        )}
        <div ref={end} />
      </div>

      {conversation.error && (
        <div className="thread-error" role="alert">
          {conversation.error}
        </div>
      )}

      {!website && (
        <div className="thread-prompts" aria-label="Quick prompts">
          {prompts.map((prompt) => (
            <button
              key={prompt.id}
              type="button"
              className="chip"
              disabled={conversation.busy || limitReached}
              onClick={() => void runScenario(prompt.id, prompt.question)}
            >
              <prompt.icon size={14} aria-hidden="true" />
              {prompt.label}
            </button>
          ))}
        </div>
      )}

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {human && !compact && !website && (
          <div
            className="segmented write-as"
            role="radiogroup"
            aria-label="Write as"
          >
            <button
              type="button"
              role="radio"
              aria-checked={writeAs === "owner"}
              onClick={() => setWriteAs("owner")}
            >
              You
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={writeAs === "customer"}
              onClick={() => setWriteAs("customer")}
            >
              Customer
            </button>
          </div>
        )}
        <label
          htmlFor={compact ? "try-message" : "inbox-message"}
          className="sr-only"
        >
          {website || (human && writeAs === "owner")
            ? "Reply as the business"
            : "Message as a customer"}
        </label>
        <textarea
          id={compact ? "try-message" : "inbox-message"}
          ref={input}
          rows={1}
          maxLength={500}
          value={draft}
          disabled={limitReached}
          placeholder={
            limitReached
              ? "Practice limit reached. Start a new conversation."
              : website
                ? "Reply to the visitor yourself (the AI pauses)"
                : human && writeAs === "owner"
                  ? "Reply to the customer yourself"
                  : "Ask like a customer would"
          }
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <button
          type="submit"
          className="composer-send"
          aria-label="Send message"
          disabled={conversation.busy || !draft.trim() || limitReached}
        >
          {conversation.busy ? (
            <LoaderCircle size={18} className="spin" />
          ) : (
            <ArrowUp size={18} />
          )}
        </button>
      </form>
    </section>
  );
}

function ApprovalCard({
  status,
  summary,
  busy,
  onDecide,
}: {
  status: "pending" | "approved" | "rejected" | "consumed";
  summary: string;
  busy: boolean;
  onDecide: (value: "approve" | "reject") => void;
}) {
  if (status !== "pending")
    return (
      <Pill tone={status === "rejected" ? "neutral" : "success"}>
        {status === "rejected" ? "Booking declined" : "Booking approved"}
      </Pill>
    );
  return (
    <div className="approval-card">
      <span className="decision-icon" aria-hidden="true">
        <CalendarCheck size={18} />
      </span>
      <div>
        <strong>Approve this booking request?</strong>
        <p>{summary}</p>
      </div>
      <div className="decision-actions">
        <button
          type="button"
          className="ui-btn ui-btn-ghost ui-btn-sm"
          disabled={busy}
          onClick={() => onDecide("reject")}
        >
          Decline
        </button>
        <button
          type="button"
          className="ui-btn ui-btn-primary ui-btn-sm"
          disabled={busy}
          onClick={() => onDecide("approve")}
        >
          Approve
        </button>
      </div>
    </div>
  );
}
