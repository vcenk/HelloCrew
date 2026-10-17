"use client";

import { useState } from "react";
import { Globe, MessageCircle, RotateCcw, Sparkles, Zap } from "lucide-react";

import { ChatThread, UNANSWERED } from "./chat-thread";
import { useDashboard } from "./provider";
import { Button, EmptyState, PageHeader, Pill } from "./ui";

const activityTone: Record<string, string> = {
  plan: "Planned",
  tool: "Tool",
  approval: "Needs you",
  done: "Replied",
  error: "Problem",
};

export function ConversationsView() {
  const {
    identity,
    conversation,
    resetConversation,
    showActivity,
    setShowActivity,
    toast,
    engine,
    setEngine,
    liveStatus,
  } = useDashboard();
  const liveReady = liveStatus?.state === "ready" && liveStatus.enabled;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const replies = conversation.messages.filter((m) => m.role === "assistant");
  const selected = replies.find((m) => m.id === selectedId) ?? replies[replies.length - 1];
  const lastCustomer = [...conversation.messages].reverse().find((m) => m.role === "customer");
  const pending =
    (conversation.session?.approvals.filter((a) => a.status === "pending").length ?? 0) +
    conversation.messages.reduce(
      (n, m) => n + (m.liveApprovals?.filter((a) => a.status === "pending").length ?? 0),
      0,
    );

  return (
    <div className="inbox">
      <PageHeader
        title="Conversations"
        description="Every chat your crew handles lands here. Test one now, and see what each reply used."
        actions={
          <>
            {liveReady && (
              <div className="segmented" role="radiogroup" aria-label="Reply engine">
                <button type="button" role="radio" aria-checked={engine === "practice"} onClick={() => setEngine("practice")}>
                  Practice
                </button>
                <button type="button" role="radio" aria-checked={engine === "live"} onClick={() => setEngine("live")}>
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
      <div className="inbox-grid convo-grid">
        <aside className="convo-list" aria-label="Conversation list">
          <button type="button" className="convo-item" aria-current="true">
            <span className="dash-avatar" aria-hidden="true">
              <MessageCircle size={15} />
            </span>
            <span className="convo-item-text">
              <strong>Test chat</strong>
              <small>{lastCustomer?.text ?? `Say hi to ${identity.name}`}</small>
            </span>
            {pending > 0 ? <Pill tone="attention">{pending}</Pill> : <Pill tone="neutral">You</Pill>}
          </button>
          <div className="convo-note">
            <Globe size={16} aria-hidden="true" />
            <p>Real customer chats from your website appear here once {identity.name} goes live.</p>
          </div>
        </aside>

        <ChatThread selectedId={selected?.id ?? null} onSelect={setSelectedId} />

        <aside className="trace" aria-label="How the reply was made">
          <header>
            <h2>Behind the reply</h2>
            <label className="switch">
              <input type="checkbox" checked={showActivity} onChange={(e) => setShowActivity(e.target.checked)} />
              <span aria-hidden="true" />
              Show steps in chat
            </label>
          </header>
          {!selected ? (
            <EmptyState icon={Sparkles} title="Nothing to inspect yet">
              Send a message. Each reply shows which knowledge and skills it used, and whether anything waited for you.
            </EmptyState>
          ) : (
            <>
              <p className="trace-quote">{selected.text}</p>
              {selected.usage && (
                <div className="trace-source">
                  <span>Model</span>
                  <strong>
                    {selected.usage.model}, ${(selected.usage.costMicroUsd / 1e6).toFixed(4)}
                  </strong>
                </div>
              )}
              {selected.source && (
                <div className="trace-source">
                  <span>Source</span>
                  <strong>{selected.source === UNANSWERED ? "Not in knowledge yet" : selected.source}</strong>
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
              ? "Live replies use your approved knowledge and the skills you allowed. Bookings wait for you, and nothing is sent outside HelloCrew."
              : "Practice replies come from your saved knowledge with fixed rules. No AI model is called, and nothing is booked or sent."}
          </p>
        </aside>
      </div>
    </div>
  );
}
