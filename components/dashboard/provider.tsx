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
import {
  businessFromKnowledge,
  createKnowledgeStoreFromBusiness,
  type KnowledgeStore,
} from "@/lib/knowledge";
import {
  CREW_STORAGE_KEY,
  defaultCrew,
  parseCrewStore,
  type CrewStore,
} from "@/lib/crew";
import { readKnowledgeStore } from "@/lib/knowledge-storage";
import { sampleBusiness, type BusinessProfile } from "@/lib/business";
import type { Scenario } from "@/lib/demo";
import type { NeedsYou, ThreadSummary } from "@/lib/conversations";
import { useConversations, type Conversation, type Engine } from "./use-conversations";
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

export type { ChatMessage, Engine, LiveApproval } from "./use-conversations";
export { MAX_PRACTICE_TURNS } from "./use-conversations";

export type Theme = "system" | "light" | "dark";
export type Toast = {
  id: number;
  text: string;
  tone: "success" | "info" | "error";
};

type DashboardState = {
  hydrated: boolean;
  knowledge: KnowledgeStore;
  saveKnowledge: (next: KnowledgeStore) => void;
  crew: CrewStore;
  saveCrew: (next: CrewStore) => void;
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
  threads: ThreadSummary[];
  needsYou: NeedsYou | null;
  refreshThreads: () => Promise<void>;
  reloadActive: () => Promise<void>;
  openThread: (id: string) => Promise<void>;
  changeThread: (action: "take_over" | "hand_back" | "close" | "reopen") => Promise<void>;
  deleteThread: (id: string) => Promise<void>;
  decideStored: (approvalId: string, value: "approve" | "reject") => Promise<void>;
  send: (message: string, as?: "customer" | "owner") => Promise<boolean>;
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

const THEME_KEY = "hellocrew:dashboard:theme";
const ACTIVITY_KEY = "hellocrew:dashboard:show-activity";
const ENGINE_KEY = "hellocrew:dashboard:engine";

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
  const [showActivity, setShowActivityState] = useState(true);
  const [theme, setThemeState] = useState<Theme>("system");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeStore>(() =>
    createKnowledgeStoreFromBusiness(sampleBusiness, "2026-01-01T00:00:00.000Z"),
  );
  const [crew, setCrew] = useState<CrewStore>(defaultCrew);
  const [liveStatus, setLiveStatus] = useState<LiveAiStatus | null>(null);
  const [engine, setEngineState] = useState<Engine>("practice");
  const toastId = useRef(0);

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
      const storedKnowledge = readKnowledgeStore(sampleBusiness);
      setKnowledge(storedKnowledge);
      setBusinessState(businessFromKnowledge(storedKnowledge));
      try {
        const rawCrew = safeGet("local", CREW_STORAGE_KEY);
        setCrew(parseCrewStore(rawCrew ? JSON.parse(rawCrew) : null));
      } catch {
        setCrew(defaultCrew);
      }
      const storedTheme = safeGet("local", THEME_KEY);
      if (storedTheme === "light" || storedTheme === "dark")
        setThemeState(storedTheme);
      if (safeGet("local", ACTIVITY_KEY) === "false")
        setShowActivityState(false);
      setHydrated(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [sync.ready]);

  const saveKnowledge = useCallback((next: KnowledgeStore) => {
    setKnowledge(next);
    setBusinessState(businessFromKnowledge(next));
    persistLocal("knowledge", next);
  }, []);

  const saveCrew = useCallback((next: CrewStore) => {
    setCrew(next);
    persistLocal("crew", next);
  }, []);

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
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      if (sync.account.status !== "signed_in") {
        setLiveStatus(null);
        setEngineState("practice");
      } else void refreshLive();
    });
    return () => {
      cancelled = true;
    };
  }, [sync.account.status, refreshLive]);

  const {
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
  } = useConversations({
    ready: hydrated,
    account: sync.account,
    identity,
    business,
    crew,
    engine,
    setEngine,
    refreshLive,
    setLiveStatus,
    toast,
  });

  const purpose =
    getAssistantPurposePreset(identity.purpose) ??
    getAssistantPurposePreset("custom")!;

  const value = useMemo<DashboardState>(
    () => ({
      hydrated,
      knowledge,
      saveKnowledge,
      crew,
      saveCrew,
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
      threads,
      needsYou,
      refreshThreads,
      reloadActive,
      openThread,
      changeThread,
      deleteThread,
      decideStored,
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
      knowledge,
      saveKnowledge,
      crew,
      saveCrew,
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
      threads,
      needsYou,
      refreshThreads,
      reloadActive,
      openThread,
      changeThread,
      deleteThread,
      decideStored,
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
      title: "Meet your receptionist",
      detail: `${identity.name} has a name, a greeting and a safe fallback.`,
      done: Boolean(identity.name && identity.greeting),
      href: "/app/crew/receptionist/personality",
      action: "Edit personality",
    },
    {
      id: "knowledge",
      title: "Approve what your crew may say",
      detail:
        facts > 0
          ? `${facts} approved fact${facts === 1 ? "" : "s"}: hours, services and FAQs.`
          : "Add hours, services and FAQs, then approve them.",
      done: facts > 0,
      href: "/app/knowledge",
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
      href: "/app/conversations",
      action: "Start a test chat",
    },
  ];
  return { steps, done: steps.filter((s) => s.done).length };
}
