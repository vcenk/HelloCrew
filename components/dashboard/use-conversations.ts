"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  decideApproval,
  listConversations,
  loadNeedsYouSummary,
  openConversation,
  removeConversation,
  saveMessages,
  updateConversation,
  updateLead,
} from "@/app/app/conversation-actions";
import type { LiveAiStatus } from "@/app/app/actions";
import { replyOnChannel } from "@/app/app/channel-actions";
import type { AssistantIdentity } from "@/lib/assistant";
import type { BusinessProfile } from "@/lib/business";
import {
  UNANSWERED_SOURCE,
  type NeedsYou,
  type StoredApproval,
  type StoredMessage,
  type StoredMessageInput,
  type ThreadMode,
  type ThreadChannel,
  type ThreadStatus,
  type ThreadSummary,
} from "@/lib/conversations";
import type { CrewStore } from "@/lib/crew";
import type { Activity, DemoResult, DemoSession, Scenario } from "@/lib/demo";
import type { Account } from "./workspace-sync";

export type LiveApproval = {
  id: string;
  summary: string;
  status: "pending" | "approved" | "rejected" | "consumed";
};

export type ChatMessage = {
  id: string;
  role: "customer" | "assistant" | "owner";
  text: string;
  at: number;
  activity?: Activity[];
  pendingId?: string;
  source?: string;
  engine?: "practice" | "live" | "human";
  liveApprovals?: LiveApproval[];
  usage?: { model: string; costMicroUsd: number; modelRounds: number };
  // The customer question this reply couldn't answer.
  question?: string;
};

export type Engine = "practice" | "live";

export type Conversation = {
  id: string;
  session: DemoSession | null;
  messages: ChatMessage[];
  busy: boolean;
  error: string;
  mode: ThreadMode;
  status: ThreadStatus;
  channel: ThreadChannel;
};

const CONVERSATION_KEY = "hellocrew:dashboard:conversation:v2";
export const MAX_PRACTICE_TURNS = 12;

function freshSession(): DemoSession {
  return { id: crypto.randomUUID(), turn: 0, approvals: [] };
}

function emptyConversation(): Conversation {
  return {
    id: crypto.randomUUID(),
    session: freshSession(),
    messages: [],
    busy: false,
    error: "",
    mode: "ai",
    status: "open",
    channel: "test",
  };
}

function toStored(m: ChatMessage): StoredMessageInput {
  return {
    id: m.id,
    role: m.role,
    text: m.text.slice(0, 4000),
    engine: m.engine,
    meta: {
      activity: m.activity?.slice(0, 12).map((a) => ({
        label: a.label.slice(0, 160),
        detail: a.detail.slice(0, 600),
        kind: a.kind,
      })),
      source: m.source && m.source !== UNANSWERED_SOURCE ? m.source.slice(0, 160) : undefined,
      unanswered: m.source === UNANSWERED_SOURCE || undefined,
      question: m.question?.slice(0, 500),
      pendingId: m.pendingId,
    },
  };
}

function fromStored(m: StoredMessage, approvals: StoredApproval[]): ChatMessage {
  const own = approvals.filter((a) => a.messageId === m.id);
  return {
    id: m.id,
    role: m.role,
    text: m.text,
    at: m.at,
    engine: m.engine,
    activity: m.meta.activity,
    source: m.meta.unanswered ? UNANSWERED_SOURCE : m.meta.source,
    question: m.meta.question,
    pendingId: m.meta.pendingId,
    usage: m.meta.usage,
    liveApprovals: own.length
      ? own.map((a) => ({ id: a.id, summary: a.summary, status: a.status }))
      : undefined,
  };
}

function safeSession(read: true): string | null;
function safeSession(read: false, value: string): void;
function safeSession(read: boolean, value?: string) {
  try {
    if (read) return sessionStorage.getItem(CONVERSATION_KEY);
    sessionStorage.setItem(CONVERSATION_KEY, value!);
  } catch {
    /* storage unavailable */
  }
  return null;
}

export function useConversations(deps: {
  ready: boolean;
  account: Account;
  identity: AssistantIdentity;
  business: BusinessProfile;
  crew: CrewStore;
  engine: Engine;
  setEngine: (engine: Engine) => void;
  refreshLive: () => Promise<void>;
  setLiveStatus: React.Dispatch<React.SetStateAction<LiveAiStatus | null>>;
  toast: (text: string, tone?: "success" | "info" | "error") => void;
}) {
  const { ready, account, identity, business, crew, engine, setEngine, refreshLive, setLiveStatus, toast } = deps;
  const signedIn = account.status === "signed_in";
  const [conversation, setConversation] = useState<Conversation>(emptyConversation);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [needsYou, setNeedsYou] = useState<NeedsYou | null>(null);
  const lock = useRef(false);
  const restored = useRef(false);

  // Restore the open conversation for this tab.
  useEffect(() => {
    if (!ready || restored.current) return;
    restored.current = true;
    const raw = safeSession(true);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Partial<Conversation>;
      if (typeof parsed.id === "string" && Array.isArray(parsed.messages))
        setConversation((c) => ({
          ...c,
          id: parsed.id!,
          session: parsed.session ?? freshSession(),
          messages: parsed.messages!,
          mode: parsed.mode === "human" ? "human" : "ai",
          status: parsed.status ?? "open",
          channel: parsed.channel ?? "test",
        }));
    } catch {
      /* ignore malformed state */
    }
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const { busy: _busy, error: _error, ...rest } = conversation;
    void _busy;
    void _error;
    safeSession(false, JSON.stringify(rest));
  }, [ready, conversation]);

  const refreshThreads = useCallback(async () => {
    if (!signedIn) {
      setThreads([]);
      setNeedsYou(null);
      return;
    }
    const [list, needs] = await Promise.all([
      listConversations().catch(() => null),
      loadNeedsYouSummary().catch(() => null),
    ]);
    if (list?.ok) setThreads(list.threads);
    if (needs?.ok) setNeedsYou(needs.needsYou);
  }, [signedIn]);

  useEffect(() => {
    if (!ready) return;
    // Defer so the first paint isn't blocked by the list request.
    const timer = window.setTimeout(() => void refreshThreads(), 0);
    return () => window.clearTimeout(timer);
  }, [ready, refreshThreads]);

  const updateThread = useCallback((thread: ThreadSummary) => {
    setThreads((list) => [thread, ...list.filter((t) => t.id !== thread.id)]);
    setConversation((c) =>
      c.id === thread.id ? { ...c, mode: thread.mode, status: thread.status, channel: thread.channel } : c,
    );
  }, []);

  // Saves browser-made turns. Failures keep the chat on screen.
  const persist = useCallback(
    async (conversationId: string, messages: ChatMessage[]) => {
      if (!signedIn || messages.length === 0) return;
      const result = await saveMessages({ conversationId, messages: messages.map(toStored) }).catch(() => null);
      if (result?.ok) {
        updateThread(result.thread);
        void loadNeedsYouSummary().then((r) => r.ok && setNeedsYou(r.needsYou)).catch(() => undefined);
      } else toast(result?.error ?? "Couldn’t save this chat. It stays in this tab.", "error");
    },
    [signedIn, toast, updateThread],
  );

  const appendLocal = useCallback((messages: ChatMessage[]) => {
    setConversation((c) => ({ ...c, messages: [...c.messages, ...messages] }));
  }, []);

  // ---------- Practice engine ----------
  const call = useCallback(
    async (payload: Record<string, unknown>, customerText: string | null): Promise<boolean> => {
      if (lock.current) return false;
      lock.current = true;
      const conversationId = conversation.id;
      const session = conversation.session ?? freshSession();
      const customer: ChatMessage | null = customerText
        ? { id: crypto.randomUUID(), role: "customer", text: customerText, at: Date.now(), engine: "practice" }
        : null;
      setConversation((c) => ({
        ...c,
        session,
        busy: true,
        error: "",
        messages: customer ? [...c.messages, customer] : c.messages,
      }));
      try {
        const response = await fetch("/api/demo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session, ...payload }),
        });
        const result = (await response.json()) as DemoResult & { error?: string };
        if (!response.ok) throw new Error(result.error ?? "That step didn’t finish. Try again.");
        const unanswered = result.source === UNANSWERED_SOURCE;
        const reply: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          text: unanswered ? identity.fallback : result.reply,
          at: Date.now(),
          activity: result.activity,
          pendingId: result.pendingId,
          source: result.source,
          engine: "practice",
          question: unanswered ? customerText ?? undefined : undefined,
        };
        setConversation((c) => ({ ...c, session: result.session, busy: false, messages: [...c.messages, reply] }));
        void persist(conversationId, customer ? [customer, reply] : [reply]);
        return true;
      } catch (error) {
        setConversation((c) => ({
          ...c,
          busy: false,
          error: error instanceof Error ? error.message : "Something went wrong. Try again.",
        }));
        return false;
      } finally {
        lock.current = false;
      }
    },
    [conversation.id, conversation.session, identity.fallback, persist],
  );

  // ---------- Live AI ----------
  const callLive = useCallback(
    async (text: string): Promise<boolean> => {
      if (lock.current) return false;
      lock.current = true;
      const conversationId = conversation.id;
      const customer: ChatMessage = { id: crypto.randomUUID(), role: "customer", text, at: Date.now(), engine: "live" };
      setConversation((c) => ({ ...c, busy: true, error: "", messages: [...c.messages, customer] }));
      try {
        const response = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId, message: { id: customer.id, text: text.slice(0, 1500) } }),
        });
        const result = (await response.json()) as {
          code?: string;
          error?: string;
          status: ThreadStatus;
          messageId: string;
          reply: string;
          unanswered?: boolean;
          activity: Activity[];
          approvals: { id: string; summary: string }[];
          usage: { model: string; costMicroUsd: number; modelRounds: number };
          spentMicroUsd: number;
          budgetMicroUsd: number;
        };
        if (!response.ok) {
          if (["budget_exhausted", "live_off", "not_configured", "signed_out"].includes(result.code ?? "")) {
            setEngine("practice");
            void refreshLive();
          }
          throw new Error(result.error ?? "The AI didn’t answer. Try again.");
        }
        setConversation((c) => ({
          ...c,
          busy: false,
          status: result.status,
          messages: [
            ...c.messages,
            {
              id: result.messageId,
              role: "assistant",
              text: result.reply,
              at: Date.now(),
              activity: result.activity,
              engine: "live",
              usage: result.usage,
              source: result.unanswered ? UNANSWERED_SOURCE : undefined,
              question: result.unanswered ? text : undefined,
              liveApprovals: result.approvals.map((a) => ({ ...a, status: "pending" as const })),
            },
          ],
        }));
        setLiveStatus((status) =>
          status?.state === "ready"
            ? { ...status, spentMicroUsd: result.spentMicroUsd, budgetMicroUsd: result.budgetMicroUsd }
            : status,
        );
        void refreshThreads();
        return true;
      } catch (error) {
        setConversation((c) => ({
          ...c,
          busy: false,
          error: error instanceof Error ? error.message : "Something went wrong. Try again.",
        }));
        return false;
      } finally {
        lock.current = false;
      }
    },
    [conversation.id, refreshLive, refreshThreads, setEngine, setLiveStatus],
  );

  // A person is in the chat: store the customer's message, no AI reply.
  const sendWhileHuman = useCallback(
    async (text: string, as: "customer" | "owner") => {
      const message: ChatMessage = {
        id: crypto.randomUUID(),
        role: as,
        text,
        at: Date.now(),
        engine: "human",
      };
      appendLocal([message]);
      await persist(conversation.id, [message]);
      return true;
    },
    [appendLocal, conversation.id, persist],
  );

  const replyLocally = useCallback(
    (question: string, text: string, label: string) => {
      const at = Date.now();
      const messages: ChatMessage[] = [
        { id: crypto.randomUUID(), role: "customer", text: question, at, engine: "practice" },
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text,
          at: at + 1,
          engine: "practice",
          activity: [{ label, detail: "Changed on the Crew page under Skills.", kind: "done" }],
        },
      ];
      setConversation((c) => ({ ...c, error: "", messages: [...c.messages, ...messages] }));
      void persist(conversation.id, messages);
      return Promise.resolve(true);
    },
    [conversation.id, persist],
  );

  const takeOverFirst = useRef<(() => Promise<void>) | null>(null);

  const send = useCallback(
    async (message: string, as: "customer" | "owner" = "customer") => {
      const text = message.trim();
      if (!text) return false;
      // In a real customer chat the owner can only reply as themselves, which
      // takes the chat over from the AI.
      if (conversation.channel !== "test") {
        if (conversation.mode === "ai") await takeOverFirst.current?.();
        if (conversation.channel === "website") return sendWhileHuman(text, "owner");
        // Messenger, Instagram, WhatsApp: deliver first, then show it.
        const id = crypto.randomUUID();
        const result = await replyOnChannel({ conversationId: conversation.id, messageId: id, text }).catch(() => null);
        if (!result?.ok) {
          toast(result?.error ?? "Couldn’t send. Try again.", "error");
          return false;
        }
        appendLocal([{ id, role: "owner", text, at: Date.now(), engine: "human" }]);
        void refreshThreads();
        return true;
      }
      if (conversation.mode === "human" || as === "owner") return sendWhileHuman(text, as);
      if (engine === "live") return callLive(text);
      return call({ message: text, business }, text);
    },
    [appendLocal, business, call, callLive, conversation.channel, conversation.id, conversation.mode, engine, refreshThreads, sendWhileHuman, toast],
  );

  const runScenario = useCallback(
    (scenario: Scenario, question: string) => {
      if (conversation.mode === "human") return sendWhileHuman(question, "customer");
      if (engine === "live") return callLive(question);
      const skills = crew.members[0].skills;
      if (scenario === "booking" && skills.booking === "off")
        return replyLocally(
          question,
          `I can’t take bookings here. ${business.bookingUrl ? `You can book at ${business.bookingUrl}.` : "Please contact the business directly to book."}`,
          "Booking requests are off",
        );
      if (scenario === "handoff" && skills.handoff === "off")
        return replyLocally(question, identity.fallback, "Passing to a person is off");
      return scenario === "booking" ? call({ scenario }, question) : call({ message: question, business }, question);
    },
    [business, call, callLive, conversation.mode, crew, engine, identity.fallback, replyLocally, sendWhileHuman],
  );

  const decide = useCallback(
    async (id: string, value: "approve" | "reject") => {
      const ok = await call({ decision: { id, value } }, null);
      if (ok) toast(value === "approve" ? "Booking approved" : "Booking declined", value === "approve" ? "success" : "info");
      return ok;
    },
    [call, toast],
  );

  // Owner decision on a stored (live) approval, from a chat or from Today.
  const decideStored = useCallback(
    async (approvalId: string, value: "approve" | "reject") => {
      const decision: "approved" | "rejected" = value === "approve" ? "approved" : "rejected";
      const result = await decideApproval({ approvalId, decision }).catch(() => null);
      if (!result?.ok) {
        toast(result?.error ?? "That approval couldn’t be updated.", "error");
        return;
      }
      setConversation((c) => {
        const touches = c.messages.some((m) => m.liveApprovals?.some((a) => a.id === approvalId));
        if (!touches) return c;
        const messages = c.messages.map((m) =>
          m.liveApprovals?.some((a) => a.id === approvalId)
            ? {
                ...m,
                liveApprovals: m.liveApprovals.map((a) =>
                  a.id === approvalId && a.status === "pending" ? { ...a, status: decision } : a,
                ),
              }
            : m,
        );
        const follow = result.message ? [fromStored(result.message, [])] : [];
        return { ...c, messages: [...messages, ...follow] };
      });
      toast(
        result.message ? (value === "approve" ? "Booking approved" : "Booking declined") : "Already decided",
        value === "approve" ? "success" : "info",
      );
      void refreshThreads();
    },
    [refreshThreads, toast],
  );

  // Signed-out live approvals don't exist (live AI needs an account).
  const decideLive = useCallback(
    (_messageId: string, approvalId: string, value: "approve" | "reject") => void decideStored(approvalId, value),
    [decideStored],
  );

  const resetConversation = useCallback(() => {
    if (lock.current) return;
    setConversation(emptyConversation());
  }, []);

  const openThread = useCallback(
    async (id: string) => {
      if (lock.current || id === conversation.id) return;
      const result = await openConversation(id).catch(() => null);
      if (!result?.ok) {
        toast(result?.error ?? "Couldn’t open that conversation.", "error");
        if (result?.reason === "not_found") void refreshThreads();
        return;
      }
      setConversation({
        id: result.thread.id,
        session: freshSession(),
        messages: result.messages.map((m) => fromStored(m, result.approvals)),
        busy: false,
        error: "",
        mode: result.thread.mode,
        status: result.thread.status,
        channel: result.thread.channel,
      });
    },
    [conversation.id, refreshThreads, toast],
  );

  // Re-reads the open saved conversation (new visitor messages, decisions).
  const reloadActive = useCallback(async () => {
    if (!signedIn || lock.current) return;
    const id = conversation.id;
    const result = await openConversation(id).catch(() => null);
    if (!result?.ok) return;
    setConversation((c) =>
      c.id !== id || c.busy
        ? c
        : {
            ...c,
            messages: result.messages.map((m) => fromStored(m, result.approvals)),
            mode: result.thread.mode,
            status: result.thread.status,
            channel: result.thread.channel,
          },
    );
  }, [conversation.id, signedIn]);

  const changeThread = useCallback(
    async (action: "take_over" | "hand_back" | "close" | "reopen") => {
      if (!signedIn) {
        // Local only: still let the owner try taking over.
        setConversation((c) => ({
          ...c,
          mode: action === "take_over" ? "human" : action === "hand_back" ? "ai" : c.mode,
          status: action === "close" ? "closed" : action === "take_over" ? "handoff" : "open",
        }));
        return;
      }
      if (conversation.messages.length === 0) {
        setConversation((c) => ({ ...c, mode: action === "take_over" ? "human" : "ai" }));
        return;
      }
      const result = await updateConversation({ conversationId: conversation.id, action }).catch(() => null);
      if (!result?.ok) {
        toast(result?.error ?? "Couldn’t update the conversation.", "error");
        return;
      }
      updateThread(result.thread);
      void loadNeedsYouSummary().then((r) => r.ok && setNeedsYou(r.needsYou)).catch(() => undefined);
      toast(
        {
          take_over: "You’re in the chat. The AI stays quiet.",
          hand_back: "Handed back to the AI",
          close: "Conversation closed",
          reopen: "Conversation reopened",
        }[action],
        "info",
      );
    },
    [conversation.id, conversation.messages.length, signedIn, toast, updateThread],
  );

  useEffect(() => {
    takeOverFirst.current = () => changeThread("take_over");
  }, [changeThread]);

  const deleteThread = useCallback(
    async (id: string) => {
      const result = await removeConversation(id).catch(() => null);
      if (!result?.ok) {
        toast(result?.error ?? "Couldn’t delete that conversation.", "error");
        return;
      }
      setThreads((list) => list.filter((t) => t.id !== id));
      if (id === conversation.id) setConversation(emptyConversation());
      void loadNeedsYouSummary().then((r) => r.ok && setNeedsYou(r.needsYou)).catch(() => undefined);
      toast("Conversation deleted", "info");
    },
    [conversation.id, toast],
  );

  const markLead = useCallback(
    async (leadId: string, status: "contacted" | "won" | "lost") => {
      const result = await updateLead({ leadId, status }).catch(() => null);
      if (!result?.ok) {
        toast(result?.error ?? "Couldn’t update the lead.", "error");
        return;
      }
      setNeedsYou((n) => (n ? { ...n, leads: n.leads.filter((l) => l.id !== leadId) } : n));
      toast(status === "contacted" ? "Marked as contacted" : status === "won" ? "Marked as won" : "Marked as lost", "info");
    },
    [toast],
  );

  return {
    markLead,
    conversation,
    threads,
    needsYou,
    refreshThreads,
    reloadActive,
    openThread,
    changeThread,
    deleteThread,
    send,
    runScenario,
    decide,
    decideLive,
    decideStored,
    resetConversation,
  };
}
