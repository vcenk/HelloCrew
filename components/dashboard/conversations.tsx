"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Bot,
  Camera,
  MessageSquare,
  Phone,
  Globe,
  Hand,
  MessageCircle,
  Plus,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";

import {
  channelLabel,
  statusLabel,
  type ThreadChannel,
  type ThreadStatus,
  type ThreadSummary,
} from "@/lib/conversations";
import { ChatThread, UNANSWERED } from "./chat-thread";
import { ConfirmDialog, useConfirm } from "./confirm-dialog";
import { ModeBadge } from "./mode-badge";
import { operatingMode } from "./operating-mode";
import { useDashboard } from "./provider";
import { Button, EmptyState, PageHeader, Pill } from "./ui";

const activityTone: Record<string, string> = {
  plan: "Planned",
  tool: "Tool",
  approval: "Needs you",
  done: "Replied",
  error: "Problem",
};

const statusTone: Record<ThreadStatus, "neutral" | "success" | "attention" | "info"> = {
  open: "success",
  waiting: "attention",
  handoff: "info",
  closed: "neutral",
};

function timeAgo(iso: string) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function ConversationsView() {
  const {
    identity,
    account,
    conversation,
    threads,
    openThread,
    changeThread,
    deleteThread,
    resetConversation,
    showActivity,
    setShowActivity,
    engine,
    setEngine,
    liveStatus,
    hydrated,
    refreshThreads,
    reloadActive,
  } = useDashboard();
  const params = useSearchParams();
  const router = useRouter();
  const liveReady = liveStatus?.state === "ready" && liveStatus.enabled;
  const signedIn = account.status === "signed_in";
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const replies = conversation.messages.filter((m) => m.role === "assistant");
  const selected = replies.find((m) => m.id === selectedId) ?? replies[replies.length - 1];
  const human = conversation.mode === "human";
  const confirmDelete = useConfirm();
  const mode = operatingMode({
    account,
    engine,
    live: liveStatus,
    conversationMode: conversation.mode,
    channel: conversation.channel,
  });

  // /app/conversations?c=<id> opens that conversation, and the id stays in the
  // URL so Back, Forward and refresh all land on the same chat.
  const requested = params.get("c");
  useEffect(() => {
    if (!hydrated || !requested || requested === conversation.id) return;
    void openThread(requested);
  }, [hydrated, requested, conversation.id, openThread]);

  // Opening a saved chat from the list writes it back into the URL.
  const openAndTrack = (id: string) => {
    setSelectedId(null);
    void openThread(id);
    router.replace(`/app/conversations?c=${encodeURIComponent(id)}`, {
      scroll: false,
    });
  };

  // Website chats arrive on their own: keep the list and the open chat fresh.
  const savedWebsite = conversation.channel !== "test";
  useEffect(() => {
    if (!signedIn) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshThreads();
      if (savedWebsite) void reloadActive();
    }, 6000);
    return () => window.clearInterval(timer);
  }, [signedIn, savedWebsite, refreshThreads, reloadActive]);

  // The open chat appears in the list even before it is saved.
  const current: ThreadSummary | null =
    conversation.messages.length > 0 && !threads.some((t) => t.id === conversation.id)
      ? {
          id: conversation.id,
          channel: conversation.channel,
          title: conversation.messages.find((m) => m.role === "customer")?.text ?? "New conversation",
          status: conversation.status,
          mode: conversation.mode,
          lastMessageAt: new Date(conversation.messages[conversation.messages.length - 1].at).toISOString(),
          preview: conversation.messages[conversation.messages.length - 1].text,
          messageCount: conversation.messages.length,
        }
      : null;
  const list = current ? [current, ...threads] : threads;

  return (
    <div className="inbox">
      <PageHeader
        title="Conversations"
        description="Every chat your crew handles lands here. Test one now, and see what each reply used."
        actions={
          <>
            <ModeBadge mode={mode} />
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
              variant="primary"
              icon={Plus}
              disabled={conversation.busy || conversation.messages.length === 0}
              onClick={() => {
                resetConversation();
                setSelectedId(null);
              }}
            >
              New conversation
            </Button>
          </>
        }
      />
      <div className="inbox-grid convo-grid">
        <aside className="convo-list" aria-label="Conversation list">
          {list.length === 0 ? (
            <div className="convo-item" aria-current="true">
              <span className="dash-avatar" aria-hidden="true">
                <MessageCircle size={15} />
              </span>
              <span className="convo-item-text">
                <strong>New test chat</strong>
                <small>Say hi to {identity.name}</small>
              </span>
            </div>
          ) : (
            <ul className="convo-items">
              {list.map((thread) => (
                <li key={thread.id}>
                  <button
                    type="button"
                    className="convo-item"
                    aria-current={thread.id === conversation.id ? "true" : undefined}
                    onClick={() => openAndTrack(thread.id)}
                  >
                    <span className="dash-avatar" data-channel={thread.channel} aria-hidden="true">
                      <ChannelIcon channel={thread.channel} />
                    </span>
                    <span className="convo-item-text">
                      <span className="channel-tag" data-channel={thread.channel}>
                        {channelLabel[thread.channel]}
                      </span>
                      <strong>{thread.title}</strong>
                      <small>{thread.preview}</small>
                    </span>
                    <span className="convo-item-meta">
                      <time dateTime={thread.lastMessageAt}>{timeAgo(thread.lastMessageAt)}</time>
                      {thread.status !== "open" && <Pill tone={statusTone[thread.status]}>{statusLabel[thread.status]}</Pill>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="convo-note">
            <Globe size={16} aria-hidden="true" />
            <p>
              {signedIn
                ? `Test chats are saved here, next to real chats from your website, Messenger, Instagram and WhatsApp.`
                : "Sign in to keep test chats. Right now this chat lives only in this tab."}
            </p>
          </div>
        </aside>

        <div className="convo-main">
          {conversation.messages.length > 0 && (
            <div className="convo-actions" role="toolbar" aria-label="Conversation actions">
              <Pill tone={statusTone[conversation.status]}>{statusLabel[conversation.status]}</Pill>
              <span className="convo-actions-spacer" />
              {human ? (
                <Button size="sm" variant="secondary" icon={Bot} onClick={() => void changeThread("hand_back")}>
                  Hand back to AI
                </Button>
              ) : (
                <Button size="sm" variant="secondary" icon={Hand} onClick={() => void changeThread("take_over")}>
                  Take over
                </Button>
              )}
              {conversation.status === "closed" ? (
                <Button size="sm" variant="ghost" icon={ArchiveRestore} onClick={() => void changeThread("reopen")}>
                  Reopen
                </Button>
              ) : (
                <Button size="sm" variant="ghost" icon={Archive} onClick={() => void changeThread("close")}>
                  Close
                </Button>
              )}
              {signedIn && conversation.channel === "test" && threads.some((t) => t.id === conversation.id) && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={Trash2}
                  aria-label="Delete conversation"
                  onClick={() => {
                    const thread = threads.find((t) => t.id === conversation.id);
                    confirmDelete.confirm({
                      title: "Delete this conversation?",
                      body: (
                        <>
                          “{thread?.title ?? "This conversation"}” and its
                          replies will be removed from your workspace. This
                          can’t be undone.
                        </>
                      ),
                      confirmLabel: "Delete conversation",
                      tone: "danger",
                      onConfirm: () => deleteThread(conversation.id),
                    });
                  }}
                />
              )}
            </div>
          )}
          <ChatThread selectedId={selected?.id ?? null} onSelect={setSelectedId} />
        </div>

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
            {/* Same source of truth as the badge, so the two can't disagree. */}
            {mode.detail}
          </p>
        </aside>
      </div>
      <ConfirmDialog
        request={confirmDelete.request}
        onClose={confirmDelete.close}
      />
    </div>
  );
}

function ChannelIcon({ channel }: { channel: ThreadChannel }) {
  const Icon = { test: MessageCircle, website: Globe, messenger: MessageSquare, instagram: Camera, whatsapp: Phone }[channel];
  return <Icon size={15} aria-label={channelLabel[channel]} />;
}
