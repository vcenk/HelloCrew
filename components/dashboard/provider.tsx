"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ASSISTANT_IDENTITY_STORAGE_KEY,
  getAssistantPurposePreset,
  parseStoredAssistantIdentity,
  sampleAssistantIdentity,
  type AssistantIdentity,
  type AssistantPurposePreset,
} from "@/lib/assistant";
import { businessFromKnowledge } from "@/lib/knowledge";
import { readKnowledgeStore } from "@/lib/knowledge-storage";
import { sampleBusiness, type BusinessProfile } from "@/lib/business";
import type { Activity, DemoResult, DemoSession, Scenario } from "@/lib/demo";
import { persistLocal } from "@/lib/workspace-documents";
import {
  getLiveAiStatus,
  updateLiveAi,
  type LiveAiStatus,
} from "@/app/app/actions";
import {
  useWorkspaceSync,
  type Account,
  type SaveStatus,
} from "./workspace-sync";
import {
  LEGACY_WORKFLOW_STORAGE_KEY,
  WORKFLOW_STORAGE_KEY,
  missingWorkflowReadiness,
  parseStoredWorkflowReadiness,
  type WorkflowReadiness,
} from "@/lib/workflow-readiness";

export type ChatMessage = {
  id: string;
  role: "customer" | "assistant";
  text: string;
  at: number;
  activity?: Activity[];
  pendingId?: string;
  source?: string;
  engine?: "practice" | "live";
  liveApprovals?: LiveApproval[];
  usage?: { model: string; costMicroUsd: number; modelRounds: number };
};

export type LiveApproval = {
  id: string;
  summary: string;
  status: "pending" | "approved" | "rejected";
};

export type Engine = "practice" | "live";

export type Theme = "system" | "light" | "dark";
export type Toast = {
  id: number;
  text: string;
  tone: "success" | "info" | "error";
};

type Conversation = {
  session: DemoSession | null;
  messages: ChatMessage[];
  busy: boolean;
  error: string;
};

type DashboardState = {
  hydrated: boolean;
  account: Account;
  saveStatus: SaveStatus;
  retrySave: () => void;
  business: BusinessProfile;
  setBusiness: (business: BusinessProfile) => void;
  identity: AssistantIdentity;
  purpose: AssistantPurposePreset;
  saveIdentity: (identity: AssistantIdentity) => void;
  workflowReadiness: WorkflowReadiness;
  setWorkflowReadiness: (readiness: WorkflowReadiness) => void;
  conversation: Conversation;
  send: (message: string) => Promise<boolean>;
  runScenario: (scenario: Scenario, question: string) => Promise<boolean>;
  decide: (id: string, value: "approve" | "reject") => Promise<boolean>;
  resetConversation: () => void;
  liveStatus: LiveAiStatus | null;
  refreshLive: () => Promise<void>;
  toggleLive: (enabled: boolean) => Promise<void>;
  engine: Engine;
  setEngine: (engine: Engine) => void;
  decideLive: (
    messageId: string,
    approvalId: string,
    value: "approve" | "reject",
  ) => void;
  showActivity: boolean;
  setShowActivity: (value: boolean) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toasts: Toast[];
  toast: (text: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: number) => void;
};

const DashboardContext = createContext<DashboardState | null>(null);

const CONVERSATION_KEY = "hellocrew:dashboard:conversation:v1";
const THEME_KEY = "hellocrew:dashboard:theme";
const ACTIVITY_KEY = "hellocrew:dashboard:show-activity";
const ENGINE_KEY = "hellocrew:dashboard:engine";
export const MAX_PRACTICE_TURNS = 12;

function safeGet(storage: "local" | "session", key: string) {
  try {
    return (storage === "local" ? localStorage : sessionStorage).getItem(key);
  } catch {
    return null;
  }
}
function safeSet(storage: "local" | "session", key: string, value: string) {
  try {
    (storage === "local" ? localStorage : sessionStorage).setItem(key, value);
  } catch {
    /* storage can be unavailable in private windows */
  }
}

function freshSession(): DemoSession {
  return { id: crypto.randomUUID(), turn: 0, approvals: [] };
}

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [business, setBusinessState] =
    useState<BusinessProfile>(sampleBusiness);
  const [identity, setIdentity] = useState<AssistantIdentity>(
    sampleAssistantIdentity,
  );
  const [workflowReadiness, setWorkflowReadiness] = useState<WorkflowReadiness>(
    missingWorkflowReadiness,
  );
  const [conversation, setConversation] = useState<Conversation>({
    session: null,
    messages: [],
    busy: false,
    error: "",
  });
  const [showActivity, setShowActivityState] = useState(true);
  const [theme, setThemeState] = useState<Theme>("system");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const lock = useRef(false);
  const [liveStatus, setLiveStatus] = useState<LiveAiStatus | null>(null);
  const [engine, setEngineState] = useState<Engine>("practice");
  const toastId = useRef(0);

  useEffect(() => {
    if (!hydrated) return;
    safeSet(
      "session",
      CONVERSATION_KEY,
      JSON.stringify({
        session: conversation.session,
        messages: conversation.messages,
      }),
    );
  }, [hydrated, conversation.session, conversation.messages]);

  const toast = useCallback((text: string, tone: Toast["tone"] = "success") => {
    const id = ++toastId.current;
    setToasts((list) => [...list.slice(-2), { id, text, tone }]);
    window.setTimeout(
      () => setToasts((list) => list.filter((t) => t.id !== id)),
      3800,
    );
  }, []);
  const dismissToast = useCallback(
    (id: number) => setToasts((list) => list.filter((t) => t.id !== id)),
    [],
  );

  const sync = useWorkspaceSync(toast);

  useEffect(() => {
    if (!sync.ready) return;
    const frame = requestAnimationFrame(() => {
      setIdentity(
        parseStoredAssistantIdentity(
          safeGet("local", ASSISTANT_IDENTITY_STORAGE_KEY),
        ),
      );
      setWorkflowReadiness(
        parseStoredWorkflowReadiness(
          safeGet("local", WORKFLOW_STORAGE_KEY) ??
            safeGet("local", LEGACY_WORKFLOW_STORAGE_KEY),
        ),
      );
      setBusinessState(
        businessFromKnowledge(readKnowledgeStore(sampleBusiness)),
      );
      const storedTheme = safeGet("local", THEME_KEY);
      if (storedTheme === "light" || storedTheme === "dark")
        setThemeState(storedTheme);
      if (safeGet("local", ACTIVITY_KEY) === "false")
        setShowActivityState(false);
      try {
        const raw = safeGet("session", CONVERSATION_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Pick<
            Conversation,
            "session" | "messages"
          >;
          if (Array.isArray(parsed.messages))
            setConversation((c) => ({
              ...c,
              session: parsed.session ?? null,
              messages: parsed.messages,
            }));
        }
      } catch {
        /* ignore malformed practice state */
      }
      setHydrated(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [sync.ready]);

  const setBusiness = useCallback((next: BusinessProfile) => {
    setBusinessState(next);
  }, []);

  const saveIdentity = useCallback((next: AssistantIdentity) => {
    setIdentity(next);
    persistLocal("assistant_identity", next);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    safeSet("local", THEME_KEY, next);
  }, []);

  const setShowActivity = useCallback((value: boolean) => {
    setShowActivityState(value);
    safeSet("local", ACTIVITY_KEY, String(value));
  }, []);

  const call = useCallback(
    async (
      payload: Record<string, unknown>,
      customerText: string | null,
    ): Promise<boolean> => {
      if (lock.current) return false;
      lock.current = true;
      const current = conversation.session ?? freshSession();
      setConversation((c) => ({
        ...c,
        session: current,
        busy: true,
        error: "",
        messages: customerText
          ? [
              ...c.messages,
              {
                id: crypto.randomUUID(),
                role: "customer",
                text: customerText,
                at: Date.now(),
              },
            ]
          : c.messages,
      }));
      try {
        const response = await fetch("/api/demo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session: current, ...payload }),
        });
        const result = (await response.json()) as DemoResult & {
          error?: string;
        };
        if (!response.ok)
          throw new Error(
            result.error ?? "That step didn’t finish. Try again.",
          );
        setConversation((c) => ({
          ...c,
          session: result.session,
          busy: false,
          messages: [
            ...c.messages,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              text:
                result.source === "No matching information"
                  ? identity.fallback
                  : result.reply,
              at: Date.now(),
              activity: result.activity,
              pendingId: result.pendingId,
              source: result.source,
            },
          ],
        }));
        return true;
      } catch (error) {
        setConversation((c) => ({
          ...c,
          busy: false,
          error:
            error instanceof Error
              ? error.message
              : "Something went wrong. Try again.",
        }));
        return false;
      } finally {
        lock.current = false;
      }
    },
    [conversation.session, identity.fallback],
  );

  const refreshLive = useCallback(async () => {
    const status = await getLiveAiStatus().catch(() => null);
    setLiveStatus(status);
    if (status?.state === "ready" && status.enabled)
      setEngineState(
        safeGet("local", ENGINE_KEY) === "practice" ? "practice" : "live",
      );
    else setEngineState("practice");
  }, []);

  const setEngine = useCallback((next: Engine) => {
    setEngineState(next);
    safeSet("local", ENGINE_KEY, next);
  }, []);

  const toggleLive = useCallback(
    async (enabled: boolean) => {
      const status = await updateLiveAi(enabled).catch(() => null);
      if (!status) {
        toast("Couldn’t change live AI. Try again.", "error");
        return;
      }
      setLiveStatus(status);
      if (status.state === "ready") {
        setEngine(status.enabled ? "live" : "practice");
        toast(status.enabled ? "Live AI is on" : "Live AI is off", "info");
      }
    },
    [setEngine, toast],
  );

  useEffect(() => {
    if (sync.account.status !== "signed_in") {
      setLiveStatus(null);
      setEngineState("practice");
      return;
    }
    void refreshLive();
  }, [sync.account.status, refreshLive]);

  const callLive = useCallback(
    async (text: string): Promise<boolean> => {
      if (lock.current) return false;
      lock.current = true;
      const history = [
        ...conversation.messages
          .filter((m) => m.text.trim())
          .map((m) => ({
            role:
              m.role === "customer"
                ? ("user" as const)
                : ("assistant" as const),
            content: m.text.slice(0, 1500),
          })),
        { role: "user" as const, content: text.slice(0, 1500) },
      ].slice(-20);
      // History must start with the customer.
      while (history.length > 1 && history[0].role !== "user") history.shift();
      setConversation((c) => ({
        ...c,
        busy: true,
        error: "",
        messages: [
          ...c.messages,
          {
            id: crypto.randomUUID(),
            role: "customer",
            text,
            at: Date.now(),
            engine: "live",
          },
        ],
      }));
      try {
        const response = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history }),
        });
        const result = (await response.json()) as {
          code?: string;
          error?: string;
          reply: string;
          activity: Activity[];
          approvals: { id: string; summary: string }[];
          usage: { model: string; costMicroUsd: number; modelRounds: number };
          spentMicroUsd: number;
          budgetMicroUsd: number;
        };
        if (!response.ok) {
          if (
            [
              "budget_exhausted",
              "live_off",
              "not_configured",
              "signed_out",
            ].includes(result.code ?? "")
          ) {
            setEngine("practice");
            void refreshLive();
          }
          throw new Error(result.error ?? "The AI didn’t answer. Try again.");
        }
        setConversation((c) => ({
          ...c,
          busy: false,
          messages: [
            ...c.messages,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              text: result.reply,
              at: Date.now(),
              activity: result.activity,
              engine: "live",
              usage: result.usage,
              liveApprovals: result.approvals.map((a) => ({
                ...a,
                status: "pending" as const,
              })),
            },
          ],
        }));
        setLiveStatus((status) =>
          status?.state === "ready"
            ? {
                ...status,
                spentMicroUsd: result.spentMicroUsd,
                budgetMicroUsd: result.budgetMicroUsd,
              }
            : status,
        );
        return true;
      } catch (error) {
        setConversation((c) => ({
          ...c,
          busy: false,
          error:
            error instanceof Error
              ? error.message
              : "Something went wrong. Try again.",
        }));
        return false;
      } finally {
        lock.current = false;
      }
    },
    [conversation.messages, refreshLive, setEngine],
  );

  // Live booking approvals are owner decisions on the dashboard. No calendar is
  // connected yet, so approving records the decision without booking anything.
  const decideLive = useCallback(
    (messageId: string, approvalId: string, value: "approve" | "reject") => {
      setConversation((c) => ({
        ...c,
        messages: [
          ...c.messages.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  liveApprovals: m.liveApprovals?.map((a) =>
                    a.id === approvalId && a.status === "pending"
                      ? {
                          ...a,
                          status:
                            value === "approve"
                              ? ("approved" as const)
                              : ("rejected" as const),
                        }
                      : a,
                  ),
                }
              : m,
          ),
          {
            id: crypto.randomUUID(),
            role: "assistant",
            engine: "live",
            at: Date.now(),
            text:
              value === "approve"
                ? "Good news: the business approved your booking request. You’ll get a confirmation shortly."
                : "Sorry, the business couldn’t accept that booking request. Would another time work?",
            activity: [
              {
                label:
                  value === "approve"
                    ? "Owner approved the booking"
                    : "Owner declined the booking",
                detail:
                  "No calendar is connected yet, so nothing was booked externally.",
                kind: "done",
              },
            ],
          },
        ],
      }));
      toast(
        value === "approve" ? "Booking approved" : "Booking declined",
        value === "approve" ? "success" : "info",
      );
    },
    [toast],
  );

  const send = useCallback(
    (message: string) => {
      const text = message.trim();
      if (!text) return Promise.resolve(false);
      if (engine === "live") return callLive(text);
      return call({ message: text, business }, text);
    },
    [business, call, callLive, engine],
  );

  const runScenario = useCallback(
    (scenario: Scenario, question: string) =>
      engine === "live"
        ? callLive(question)
        : scenario === "booking"
          ? call({ scenario }, question)
          : call({ message: question, business }, question),
    [business, call, callLive, engine],
  );

  const decide = useCallback(
    async (id: string, value: "approve" | "reject") => {
      const ok = await call({ decision: { id, value } }, null);
      if (ok)
        toast(
          value === "approve" ? "Booking approved" : "Booking declined",
          value === "approve" ? "success" : "info",
        );
      return ok;
    },
    [call, toast],
  );

  const resetConversation = useCallback(() => {
    if (lock.current) return;
    setConversation({
      session: freshSession(),
      messages: [],
      busy: false,
      error: "",
    });
  }, []);

  const purpose =
    getAssistantPurposePreset(identity.purpose) ??
    getAssistantPurposePreset("custom")!;

  const value = useMemo<DashboardState>(
    () => ({
      hydrated,
      account: sync.account,
      saveStatus: sync.saveStatus,
      retrySave: sync.retry,
      business,
      setBusiness,
      identity,
      purpose,
      saveIdentity,
      workflowReadiness,
      setWorkflowReadiness,
      conversation,
      send,
      runScenario,
      decide,
      resetConversation,
      liveStatus,
      refreshLive,
      toggleLive,
      engine,
      setEngine,
      decideLive,
      showActivity,
      setShowActivity,
      theme,
      setTheme,
      toasts,
      toast,
      dismissToast,
    }),
    [
      hydrated,
      sync.account,
      sync.saveStatus,
      sync.retry,
      business,
      setBusiness,
      identity,
      purpose,
      saveIdentity,
      workflowReadiness,
      conversation,
      send,
      runScenario,
      decide,
      resetConversation,
      liveStatus,
      refreshLive,
      toggleLive,
      engine,
      setEngine,
      decideLive,
      showActivity,
      setShowActivity,
      theme,
      setTheme,
      toasts,
      toast,
      dismissToast,
    ],
  );

  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const value = useContext(DashboardContext);
  if (!value)
    throw new Error("useDashboard must be used inside DashboardProvider");
  return value;
}

export function useLaunchChecklist() {
  const { business, identity, workflowReadiness, conversation } =
    useDashboard();
  const facts =
    (business.hours ? 1 : 0) + business.services.length + business.faqs.length;
  const tested = conversation.messages.some((m) => m.role === "assistant");
  const steps = [
    {
      id: "assistant",
      title: "Introduce your assistant",
      detail: `${identity.name} is set up with a greeting and a safe fallback.`,
      done: Boolean(identity.name && identity.greeting),
      href: "/app/assistant",
      action: "Edit identity",
    },
    {
      id: "knowledge",
      title: "Approve what it may say",
      detail:
        facts > 0
          ? `${facts} approved fact${facts === 1 ? "" : "s"}: hours, services and FAQs.`
          : "Add hours, services and FAQs, then approve them.",
      done: facts > 0,
      href: "/app/assistant",
      action: "Review knowledge",
    },
    {
      id: "workflow",
      title: "Publish a workflow",
      detail:
        workflowReadiness.status === "published"
          ? `${workflowReadiness.name} v${workflowReadiness.version} is published.`
          : workflowReadiness.status === "draft"
            ? `${workflowReadiness.name} is still a draft.`
            : "Pick a template for bookings, questions or reviews.",
      done: workflowReadiness.status === "published",
      href: "/app/workflows",
      action:
        workflowReadiness.status === "missing"
          ? "Choose a template"
          : "Open workflow",
    },
    {
      id: "test",
      title: "Test a conversation",
      detail: tested
        ? "You’ve reviewed at least one reply."
        : "Ask a few customer questions and check the answers.",
      done: tested,
      href: "/app/inbox",
      action: "Open inbox",
    },
  ];
  return { steps, done: steps.filter((s) => s.done).length };
}
