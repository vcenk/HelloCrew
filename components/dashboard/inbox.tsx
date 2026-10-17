"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  BookOpen,
  CalendarDays,
  Calculator,
  CalendarCheck,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  UserRound,
  Zap,
} from "lucide-react";

import type { Scenario } from "@/lib/demo";
import { MAX_PRACTICE_TURNS, useDashboard, type ChatMessage } from "./provider";
import { Button, EmptyState, PageHeader, Pill } from "./ui";

const activityTone: Record<string, string> = {
  plan: "Planned",
  tool: "Tool",
  approval: "Needs you",
  done: "Replied",
  error: "Problem",
};

export function InboxView() {
  const {
    identity,
    purpose,
    business,
    conversation,
    send,
    runScenario,
    decide,
    resetConversation,
    showActivity,
    setShowActivity,
    toast,
    engine,
    setEngine,
    liveStatus,
    decideLive,
  } = useDashboard();
  const liveReady = liveStatus?.state === "ready" && liveStatus.enabled;
  const [draft, setDraft] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const turns = conversation.session?.turn ?? 0;
  const limitReached = engine === "practice" && turns >= MAX_PRACTICE_TURNS;
  const replies = conversation.messages.filter((m) => m.role === "assistant");
  const selected =
    replies.find((m) => m.id === selectedId) ?? replies[replies.length - 1];

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
      question: "Can I book a studio visit?",
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
    const ok = await send(text);
    if (!ok) setDraft(text);
    setSelectedId(null);
    input.current?.focus();
  }

  return (
    <div className="inbox">
      <PageHeader
        title="Inbox"
        description="Chat as a customer would, and see exactly how each reply was made."
        actions={
          <>
            {liveReady && (
              <div
                className="segmented"
                role="radiogroup"
                aria-label="Reply engine"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={engine === "practice"}
                  onClick={() => setEngine("practice")}
                >
                  Practice
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={engine === "live"}
                  onClick={() => setEngine("live")}
                >
                  <Zap size={15} aria-hidden="true" />
                  Live AI
                </button>
              </div>
            )}
            <Button
              icon={RotateCcw}
              disabled={conversation.busy || conversation.messages.length === 0}
              onClick={() => {
                resetConversation();
                setSelectedId(null);
                toast("New test conversation started", "info");
              }}
            >
              New conversation
            </Button>
          </>
        }
      />
      <div className="inbox-grid">
        <section className="thread" aria-label="Test conversation">
          <header className="thread-head">
            <span className="dash-avatar" aria-hidden="true">
              {identity.name.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{identity.name}</strong>
              <small>
                {purpose.label} for {business.name}
              </small>
            </div>
            {engine === "live" && liveStatus?.state === "ready" ? (
              <Pill tone="success">
                <Zap size={13} aria-hidden="true" /> Live AI
              </Pill>
            ) : (
              <Pill tone={limitReached ? "attention" : "neutral"}>
                {turns}/{MAX_PRACTICE_TURNS} turns
              </Pill>
            )}
          </header>

          <div className="thread-body" aria-live="polite">
            {conversation.messages.length === 0 && (
              <div className="thread-intro">
                <span className="bubble bubble-assistant">
                  {identity.greeting}
                </span>
                <p>
                  Ask anything a customer might, or start with one of the
                  prompts below.
                </p>
              </div>
            )}
            {conversation.messages.map((message) => (
              <MessageRow
                key={message.id}
                message={message}
                assistantName={identity.name}
                selected={selected?.id === message.id}
                onSelect={() => setSelectedId(message.id)}
                approval={conversation.session?.approvals.find(
                  (a) => a.id === message.pendingId,
                )}
                busy={conversation.busy}
                onDecide={(value) =>
                  message.pendingId && decide(message.pendingId, value)
                }
                onDecideLive={(approvalId, value) =>
                  decideLive(message.id, approvalId, value)
                }
              />
            ))}
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

          <div className="thread-prompts" aria-label="Quick prompts">
            {prompts.map((prompt) => (
              <button
                key={prompt.id}
                type="button"
                className="chip"
                disabled={conversation.busy || limitReached}
                onClick={() => {
                  setSelectedId(null);
                  void runScenario(prompt.id, prompt.question);
                }}
              >
                <prompt.icon size={14} aria-hidden="true" />
                {prompt.label}
              </button>
            ))}
          </div>

          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label htmlFor="inbox-message" className="sr-only">
              Message as a customer
            </label>
            <textarea
              id="inbox-message"
              ref={input}
              rows={1}
              maxLength={500}
              value={draft}
              disabled={limitReached}
              placeholder={
                limitReached
                  ? "Turn limit reached. Start a new conversation."
                  : "Write as a customer, e.g. Is parking available?"
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

        <aside className="trace" aria-label="How the reply was made">
          <header>
            <h2>Behind the reply</h2>
            <label className="switch">
              <input
                type="checkbox"
                checked={showActivity}
                onChange={(event) => setShowActivity(event.target.checked)}
              />
              <span aria-hidden="true" />
              Show steps in chat
            </label>
          </header>
          {!selected ? (
            <EmptyState icon={Sparkles} title="Nothing to inspect yet">
              Send a message. Each reply shows which facts were used and whether
              anything waited for you.
            </EmptyState>
          ) : (
            <>
              <p className="trace-quote">{selected.text}</p>
              {selected.usage && (
                <div className="trace-source">
                  <span>Model</span>
                  <strong>
                    {selected.usage.model}, $
                    {(selected.usage.costMicroUsd / 1e6).toFixed(4)}
                  </strong>
                </div>
              )}
              {selected.source && (
                <div className="trace-source">
                  <span>Source</span>
                  <strong>{selected.source}</strong>
                </div>
              )}
              <ol className="trace-steps">
                {(selected.activity ?? []).map((step, i) => (
                  <li key={i} data-kind={step.kind}>
                    <span className="trace-dot" aria-hidden="true" />
                    <div>
                      <small>{activityTone[step.kind] ?? step.kind}</small>
                      <strong>{step.label}</strong>
                      <p>{step.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
          <p className="trace-note">
            {engine === "live"
              ? "Live replies use your approved knowledge from the workspace. Bookings wait for your approval, and nothing is sent outside HelloCrew."
              : "Practice replies come from your saved facts with fixed rules. No AI model is called, and nothing is booked or sent."}
          </p>
        </aside>
      </div>
    </div>
  );
}

function MessageRow({
  message,
  assistantName,
  selected,
  onSelect,
  approval,
  busy,
  onDecide,
  onDecideLive,
}: {
  message: ChatMessage;
  assistantName: string;
  selected: boolean;
  onSelect: () => void;
  approval?: { status: "pending" | "approved" | "rejected" };
  busy: boolean;
  onDecide: (value: "approve" | "reject") => void;
  onDecideLive: (approvalId: string, value: "approve" | "reject") => void;
}) {
  const { showActivity } = useDashboard();
  if (message.role === "customer")
    return (
      <div className="row row-customer">
        <span className="bubble bubble-customer">{message.text}</span>
      </div>
    );
  return (
    <div className="row row-assistant" data-selected={selected}>
      <button
        type="button"
        className="bubble bubble-assistant"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`${assistantName}: ${message.text}. Show how this reply was made`}
      >
        {message.text}
      </button>
      {showActivity && message.activity && message.activity.length > 0 && (
        <div className="row-steps">
          {message.activity.map((step, i) => (
            <span key={i} data-kind={step.kind}>
              {step.label}
            </span>
          ))}
        </div>
      )}
      {message.pendingId &&
        approval &&
        (approval.status === "pending" ? (
          <div className="approval-card">
            <span className="decision-icon" aria-hidden="true">
              <CalendarCheck size={18} />
            </span>
            <div>
              <strong>Approve this booking?</strong>
              <p>
                1 studio visit, $40. Practice only: no real appointment is made.
              </p>
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
        ) : (
          <Pill tone={approval.status === "approved" ? "success" : "neutral"}>
            {approval.status === "approved"
              ? "Booking approved"
              : "Booking declined"}
          </Pill>
        ))}
      {message.liveApprovals?.map((item) =>
        item.status === "pending" ? (
          <div className="approval-card" key={item.id}>
            <span className="decision-icon" aria-hidden="true">
              <CalendarCheck size={18} />
            </span>
            <div>
              <strong>Approve this booking request?</strong>
              <p>{item.summary}</p>
            </div>
            <div className="decision-actions">
              <button
                type="button"
                className="ui-btn ui-btn-ghost ui-btn-sm"
                disabled={busy}
                onClick={() => onDecideLive(item.id, "reject")}
              >
                Decline
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-primary ui-btn-sm"
                disabled={busy}
                onClick={() => onDecideLive(item.id, "approve")}
              >
                Approve
              </button>
            </div>
          </div>
        ) : (
          <Pill
            key={item.id}
            tone={item.status === "approved" ? "success" : "neutral"}
          >
            {item.status === "approved"
              ? "Booking approved"
              : "Booking declined"}
          </Pill>
        ),
      )}
    </div>
  );
}
