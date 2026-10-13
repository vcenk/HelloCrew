"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ArrowUpRight,
  ArrowRight,
  Home,
  MessageCircle,
  SlidersHorizontal,
  Radio,
  Settings,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  BookOpen,
  CalendarDays,
  Calculator,
  UserRound,
  LoaderCircle,
  Workflow,
} from "lucide-react";
import { AssistantSetup } from "./knowledge-manager";
import { WebsiteChatGuide } from "./website-chat-guide";
import { sampleBusiness, type BusinessProfile } from "@/lib/business";
import { Brand, Buddy } from "./brand";
import type { Activity, DemoSession, Scenario, DemoResult } from "@/lib/demo";

const WorkflowBuilder = dynamic(
  () => import("./workflow-builder").then((module) => module.WorkflowBuilder),
  {
    ssr: false,
    loading: () => (
      <div className="workflow-loading" role="status">
        <LoaderCircle className="spin" size={20} /> Preparing the workflow
        canvas…
      </div>
    ),
  },
);
const navGroups = [
  {
    label: "Overview",
    items: [{ name: "Home", icon: Home }],
  },
  {
    label: "Build",
    items: [
      { name: "Your assistant", icon: SlidersHorizontal },
      { name: "Workflows", icon: Workflow },
    ],
  },
  {
    label: "Test & launch",
    items: [
      { name: "Conversations", icon: MessageCircle },
      { name: "Channels", icon: Radio },
    ],
  },
  {
    label: "Manage",
    items: [{ name: "Settings", icon: Settings }],
  },
] as const;
type Page = (typeof navGroups)[number]["items"][number]["name"];

const pageSlugs: Record<Page, string> = {
  Home: "home",
  "Your assistant": "assistant",
  Workflows: "workflows",
  Conversations: "conversations",
  Channels: "channels",
  Settings: "settings",
};

function pageFromUrl(): Page {
  const slug = new URLSearchParams(window.location.search).get("section");
  return (
    (Object.entries(pageSlugs).find(([, value]) => value === slug)?.[0] as
      Page | undefined) ?? "Home"
  );
}

const pageMeta: Record<Page, { phase: string; purpose: string }> = {
  Home: {
    phase: "Overview",
    purpose: "See the whole setup path and choose the next section.",
  },
  "Your assistant": {
    phase: "Build · 1 of 2",
    purpose:
      "Define who the assistant is, who it represents, and which facts it may use.",
  },
  Workflows: {
    phase: "Build · 2 of 2",
    purpose: "Define the rules, approvals, and handoffs behind each task.",
  },
  Conversations: {
    phase: "Test",
    purpose: "Review the customer-facing answer and the steps behind it.",
  },
  Channels: {
    phase: "Launch",
    purpose:
      "Preview, publish, and install the assistant where customers visit.",
  },
  Settings: {
    phase: "Manage",
    purpose: "Control this practice studio and clear its temporary data.",
  },
};

const setupPath: {
  step: string;
  verb: string;
  page: Page;
  title: string;
  description: string;
  outcome: string;
  icon: typeof Home;
}[] = [
  {
    step: "01",
    verb: "Teach",
    page: "Your assistant",
    title: "Build the assistant foundation",
    description:
      "Set its identity, add business context, and approve the knowledge it may use.",
    outcome: "Output: a grounded assistant",
    icon: SlidersHorizontal,
  },
  {
    step: "02",
    verb: "Design",
    page: "Workflows",
    title: "Choose how it should help",
    description: "Arrange tasks, safety checks, approvals, and human handoffs.",
    outcome: "Output: clear behavior rules",
    icon: Workflow,
  },
  {
    step: "03",
    verb: "Test",
    page: "Conversations",
    title: "Review the customer experience",
    description:
      "Ask sample questions and inspect the answer and activity trace.",
    outcome: "Output: reviewed conversations",
    icon: MessageCircle,
  },
  {
    step: "04",
    verb: "Launch",
    page: "Channels",
    title: "Put it on your website",
    description:
      "Preview the widget and follow publishing and installation steps.",
    outcome: "Output: an installed channel",
    icon: Radio,
  },
];

const sectionDefinitions = {
  "Your assistant": {
    job: "Assistant foundation",
    work: "Identity, business profile, approved knowledge, and source checks.",
    boundary: "Behavior rules and customer replies stay in their own sections.",
    next: "Workflows" as Page,
    nextLabel: "Define behavior",
  },
  Workflows: {
    job: "Behavior rules",
    work: "Steps, tool jobs, approvals, handoffs, and internal path tests.",
    boundary: "Customer-facing reply quality is reviewed in Conversations.",
    next: "Conversations" as Page,
    nextLabel: "Test conversations",
  },
  Conversations: {
    job: "Customer experience test",
    work: "Sample prompts, final replies, activity traces, and approval moments.",
    boundary: "Edit source facts in Your assistant and logic in Workflows.",
    next: "Channels" as Page,
    nextLabel: "Prepare a channel",
  },
  Channels: {
    job: "Delivery & installation",
    work: "Widget preview, publish readiness, embed instructions, and channel status.",
    boundary:
      "Knowledge and workflow tools are linked here, not duplicated here.",
  },
  Settings: {
    job: "Studio controls",
    work: "Practice visibility, privacy context, and disposable session data.",
    boundary:
      "Assistant content, workflow logic, and installation do not live here.",
  },
} as const;

function SectionDefinition({
  page,
  onNavigate,
}: {
  page: keyof typeof sectionDefinitions;
  onNavigate: (target: Page) => void;
}) {
  const definition = sectionDefinitions[page];
  return (
    <section
      className="section-definition"
      aria-label={`${page} section guide`}
    >
      <div>
        <span>SECTION JOB</span>
        <strong>{definition.job}</strong>
      </div>
      <div>
        <span>WORK HERE</span>
        <p>{definition.work}</p>
      </div>
      <div>
        <span>KEEP SEPARATE</span>
        <p>{definition.boundary}</p>
      </div>
      {"next" in definition && (
        <button type="button" onClick={() => onNavigate(definition.next)}>
          {definition.nextLabel} <ArrowRight size={15} />
        </button>
      )}
    </section>
  );
}
type Message = {
  role: "customer" | "assistant";
  text: string;
  activity?: Activity[];
  pendingId?: string;
};
const baseScenarios: {
  id: Scenario;
  label: string;
  question: string;
  icon: typeof BookOpen;
  description: string;
}[] = [
  {
    id: "hours",
    label: "Answer a question",
    question: "What are your opening hours?",
    icon: BookOpen,
    description: "Find an answer in the sample FAQ",
  },
  {
    id: "quote",
    label: "Check a sample price",
    question: "How much is one studio visit?",
    icon: Calculator,
    description: "Read a price from your sample catalog",
  },
  {
    id: "booking",
    label: "Try an approval",
    question: "Can I book a studio visit?",
    icon: CalendarDays,
    description: "Review before a simulated action",
  },
  {
    id: "handoff",
    label: "Ask for a person",
    question: "Can I speak with a person?",
    icon: UserRound,
    description: "Prepare a sample human handoff",
  },
];
function fresh(): DemoSession {
  return { id: crypto.randomUUID(), turn: 0, approvals: [] };
}
export default function Studio() {
  const [business, setBusiness] = useState<BusinessProfile>(sampleBusiness);
  const scenarios = baseScenarios.map((item) =>
    item.id === "quote"
      ? {
          ...item,
          question: `How much is one ${business.services[0]?.name.toLowerCase() ?? "service"}?`,
        }
      : item,
  );
  const [draftMessage, setDraftMessage] = useState("");
  const [page, setPage] = useState<Page>("Home");
  const [session, setSession] = useState<DemoSession | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activityOpen, setActivityOpen] = useState(true);
  const lock = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  const navigationStarted = useRef(false);
  useEffect(() => {
    const initialFrame = window.requestAnimationFrame(() => {
      if (!navigationStarted.current) setPage(pageFromUrl());
    });
    const handleHistory = () => setPage(pageFromUrl());
    window.addEventListener("popstate", handleHistory);
    return () => {
      window.cancelAnimationFrame(initialFrame);
      window.removeEventListener("popstate", handleHistory);
    };
  }, []);
  function navigate(target: Page) {
    if (target === page) return;
    navigationStarted.current = true;
    setPage(target);
    const url = new URL(window.location.href);
    if (target === "Home") url.searchParams.delete("section");
    else url.searchParams.set("section", pageSlugs[target]);
    window.history.pushState({}, "", url);
  }
  async function run(
    scenario?: Scenario,
    decision?: { id: string; value: "approve" | "reject" },
    message?: string,
  ) {
    if (lock.current) return;
    const question = message?.trim();
    if (message !== undefined && !question) return;
    lock.current = true;
    setBusy(true);
    setError("");
    navigate("Conversations");
    const current = session ?? fresh();
    setSession(current);
    if (scenario) {
      const item = scenarios.find((s) => s.id === scenario)!;
      setMessages((m) => [...m, { role: "customer", text: item.question }]);
    }
    if (question)
      setMessages((m) => [...m, { role: "customer", text: question }]);
    try {
      const response = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session: current,
          ...(question
            ? { message: question, business }
            : scenario && ["hours", "quote", "handoff"].includes(scenario)
              ? {
                  message: scenarios.find((s) => s.id === scenario)!.question,
                  business,
                }
              : scenario
                ? { scenario }
                : { decision }),
        }),
      });
      const result = (await response.json()) as DemoResult & { error?: string };
      if (!response.ok)
        throw new Error(result.error ?? "The practice step did not finish.");
      setSession(result.session);
      if (question) setDraftMessage("");
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: result.reply,
          activity: result.activity,
          pendingId: result.pendingId,
        },
      ]);
      setTimeout(
        () =>
          end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
        80,
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  function reset() {
    if (busy) return;
    if (
      messages.length > 0 &&
      !window.confirm(
        "Clear this disposable practice conversation and its sample approvals?",
      )
    )
      return;
    setSession(fresh());
    setMessages([]);
    setDraftMessage("");
    setError("");
  }
  const pending =
    session?.approvals.filter((a) => a.status === "pending") ?? [];
  return (
    <div className="studio-shell">
      <a className="skip-link" href="#studio-main-content">
        Skip to main content
      </a>
      <aside className="sidebar">
        <Link href="/" className="sidebar-brand">
          <Brand />
        </Link>
        <div className="workspace-switch">
          <span className="workspace-icon">H</span>
          <div>
            <strong>My practice studio</strong>
            <small>Just exploring</small>
          </div>
          <span className="badge">Demo</span>
        </div>
        <nav aria-label="Studio navigation">
          {navGroups.map((group) => (
            <div className="sidebar-nav-group" key={group.label}>
              <span className="sidebar-nav-label">{group.label}</span>
              {group.items.map((item) => (
                <button
                  type="button"
                  key={item.name}
                  className={page === item.name ? "active" : ""}
                  onClick={() => navigate(item.name)}
                  aria-current={page === item.name ? "page" : undefined}
                >
                  <item.icon size={20} aria-hidden="true" />
                  {item.name}
                  {item.name === "Conversations" && messages.length > 0 && (
                    <span className="nav-count">
                      {messages.filter((m) => m.role === "customer").length}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="small-flower">✳</div>
          <strong>Start small. Get comfortable.</strong>
          <p>This is your space to explore, one helpful step at a time.</p>
          <Link href="/">
            Visit the website <ArrowUpRight size={15} />
          </Link>
        </div>
        <div className="local-label">
          <ShieldCheck size={15} /> No live services connected
        </div>
      </aside>
      <div className="studio-main">
        <header className="studio-header">
          <div className="studio-location">
            <span>{pageMeta[page].phase}</span>
            <strong>{page}</strong>
          </div>
          <div>
            <span className="badge">
              <span className="dot" /> Practice mode
            </span>
            <span className="avatar">You</span>
          </div>
        </header>
        <main className="studio-content" id="studio-main-content" tabIndex={-1}>
          <div className="demo-notice">
            <ShieldCheck size={17} />
            <span>
              A safe place to try things. All examples are fictional. No paid AI
              calls, real bookings, or personal details.
            </span>
          </div>
          {page === "Home" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">YOUR HELLOCREW MAP</span>
                  <h1>
                    One clear path from facts to website
                    <span className="green-text">.</span>
                  </h1>
                  <p>{pageMeta.Home.purpose}</p>
                </div>
                <span className="heading-flower">✳</span>
              </div>
              <section className="welcome-card overview-welcome">
                <div>
                  <span className="badge pale">
                    Start with the assistant foundation
                  </span>
                  <h2>
                    Build once.
                    <br />
                    Move forward with confidence.
                  </h2>
                  <p>
                    Each section owns one part of the assistant. Follow the four
                    stages below; return here whenever you need orientation.
                  </p>
                  <button
                    type="button"
                    className="button dark"
                    onClick={() => navigate("Your assistant")}
                  >
                    Start with Your assistant <ArrowRight size={18} />
                  </button>
                </div>
                <div className="welcome-art">
                  <Buddy />
                  <span className="welcome-spark">✦</span>
                </div>
              </section>
              <div className="section-heading">
                <h2>How the parts fit together</h2>
                <span>Follow from left to right</span>
              </div>
              <ol className="setup-map">
                {setupPath.map((item) => (
                  <li key={item.step}>
                    <button
                      type="button"
                      className="setup-map-card"
                      onClick={() => navigate(item.page)}
                    >
                      <span className="setup-map-topline">
                        <span>{item.step}</span>
                        <item.icon size={19} aria-hidden="true" />
                      </span>
                      <span className="setup-map-verb">{item.verb}</span>
                      <strong>{item.title}</strong>
                      <p>{item.description}</p>
                      <span className="setup-map-outcome">
                        {item.outcome} <ArrowRight size={15} />
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              <section className="home-boundary-note">
                <ShieldCheck size={20} aria-hidden="true" />
                <div>
                  <strong>Home is your map, not another workspace.</strong>
                  <p>
                    Create and edit inside the four sections above. Use Settings
                    only for practice controls and temporary session data.
                  </p>
                </div>
              </section>
            </>
          )}
          {page === "Conversations" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">TRY A LITTLE CONVERSATION</span>
                  <h1>
                    The practice room<span className="green-text">.</span>
                  </h1>
                  <p>
                    Ask a sample question in your own words, or use a quick
                    prompt.
                  </p>
                </div>
                <button
                  className="button outline compact"
                  onClick={reset}
                  disabled={busy}
                >
                  <RotateCcw size={16} /> Start fresh
                </button>
              </div>
              <SectionDefinition page="Conversations" onNavigate={navigate} />
              <div className="conversation-layout">
                <section className="conversation-card">
                  <div className="conversation-top">
                    <span className="assistant-avatar">✳</span>
                    <div>
                      <strong>HelloCrew assistant</strong>
                      <span>{business.name} · deterministic practice</span>
                    </div>
                    <span className="badge">Demo</span>
                  </div>
                  <div className="message-list" aria-live="polite">
                    {messages.length === 0 && (
                      <div className="empty-conversation">
                        <span>✳</span>
                        <h2>It starts with a hello.</h2>
                        <p>
                          Pick a sample below to see your assistant in action.
                          Use fictional details only.
                        </p>
                      </div>
                    )}
                    {messages.map((m, i) => {
                      const record = session?.approvals.find(
                        (a) => a.id === m.pendingId,
                      );
                      return (
                        <div className={`message ${m.role}`} key={i}>
                          <span className="message-role">
                            {m.role === "customer"
                              ? "Sample customer"
                              : "HelloCrew"}
                          </span>
                          <p>{m.text}</p>
                          {m.activity && activityOpen && (
                            <div className="activity-list">
                              {m.activity.map((a, j) => (
                                <div key={j}>
                                  <span className={`activity-dot ${a.kind}`} />
                                  <div>
                                    <strong>{a.label}</strong>
                                    <small>{a.detail}</small>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {m.pendingId &&
                            (record?.status === "pending" ? (
                              <div className="approval-box">
                                <strong>
                                  <ShieldCheck size={17} /> Your approval is
                                  needed
                                </strong>
                                <p>
                                  1 fictional studio visit · $40 USD
                                  <br />
                                  Simulated only. No appointment or payment.
                                </p>
                                <div>
                                  <button
                                    className="button outline compact"
                                    disabled={busy}
                                    onClick={() =>
                                      run(undefined, {
                                        id: m.pendingId!,
                                        value: "reject",
                                      })
                                    }
                                  >
                                    Decline
                                  </button>
                                  <button
                                    className="button dark compact"
                                    disabled={busy}
                                    onClick={() =>
                                      run(undefined, {
                                        id: m.pendingId!,
                                        value: "approve",
                                      })
                                    }
                                  >
                                    Approve sample
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <span className="badge">
                                {record?.status === "approved"
                                  ? "Approved (demo)"
                                  : "Declined (demo)"}
                              </span>
                            ))}
                        </div>
                      );
                    })}
                    {busy && (
                      <div className="working">
                        <LoaderCircle size={16} /> Trying that practice step…
                      </div>
                    )}
                    <div ref={end} />
                  </div>
                  {error && (
                    <div className="error" role="alert">
                      {error}
                    </div>
                  )}
                  <form
                    className="free-composer"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run(undefined, undefined, draftMessage);
                    }}
                  >
                    <label htmlFor="practice-message">
                      Your practice question
                    </label>
                    <textarea
                      id="practice-message"
                      value={draftMessage}
                      onChange={(event) => setDraftMessage(event.target.value)}
                      maxLength={500}
                      rows={2}
                      disabled={busy || (session?.turn ?? 0) >= 12}
                      placeholder="Is parking available?"
                      required
                    />
                    <div>
                      <small>
                        {draftMessage.length}/500 · Fictional details only. Sent
                        to this app’s server.
                      </small>
                      <button
                        type="submit"
                        className="button dark compact"
                        disabled={
                          busy ||
                          !draftMessage.trim() ||
                          (session?.turn ?? 0) >= 12
                        }
                      >
                        Send practice question
                      </button>
                    </div>
                    {(session?.turn ?? 0) >= 12 && (
                      <p>Practice limit reached. Start fresh to continue.</p>
                    )}
                  </form>
                  <div className="sample-composer">
                    <span>CHOOSE A SAMPLE MESSAGE</span>
                    <div>
                      {scenarios.map((s) => (
                        <button
                          key={s.id}
                          disabled={busy || (session?.turn ?? 0) >= 12}
                          onClick={() => run(s.id)}
                        >
                          <s.icon size={15} />
                          {s.question}
                        </button>
                      ))}
                    </div>
                    <small>
                      The approval prompt uses the fixed $40 studio-visit
                      example. Other prompts use your applied sample
                      information.
                    </small>
                  </div>
                </section>
                <aside className="conversation-guide">
                  <div className="simple-card">
                    <Sparkles size={23} />
                    <h3>A little peek behind the scenes</h3>
                    <ol>
                      <li>
                        <strong>Understand</strong>
                        <span>The practice provider selects a tool.</span>
                      </li>
                      <li>
                        <strong>Do the helpful bit</strong>
                        <span>
                          A validated tool reads sample facts or prepares a
                          request.
                        </span>
                      </li>
                      <li>
                        <strong>Reply or check in</strong>
                        <span>
                          Its result becomes a reply. Bookings wait for
                          approval.
                        </span>
                      </li>
                    </ol>
                    <label className="toggle-line">
                      <input
                        type="checkbox"
                        checked={activityOpen}
                        onChange={(e) => setActivityOpen(e.target.checked)}
                      />{" "}
                      Show tool activity
                    </label>
                  </div>
                  <div className="session-note">
                    <ShieldCheck size={17} />
                    <p>
                      {session?.turn ?? 0} of 12 practice turns used.
                      <br />
                      {pending.length > 0
                        ? `${pending.length} sample request${pending.length > 1 ? "s" : ""} awaiting review.`
                        : "Nothing waiting for approval."}
                      <br />
                      Refresh clears this disposable session.
                    </p>
                  </div>
                </aside>
              </div>
            </>
          )}
          {page === "Your assistant" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">A HELPFUL FIRST DRAFT</span>
                  <h1>
                    Your assistant<span className="green-text">.</span>
                  </h1>
                  <p>
                    Define who it is, who it represents, and what it is allowed
                    to know.
                  </p>
                </div>
              </div>
              <SectionDefinition page="Your assistant" onNavigate={navigate} />
              <AssistantSetup
                business={business}
                disabled={busy}
                onSave={setBusiness}
              />
            </>
          )}
          {page === "Channels" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">MEET PEOPLE WHERE THEY ARE</span>
                  <h1>
                    Your channels<span className="green-text">.</span>
                  </h1>
                  <p>
                    Start with the website. Explore other connections later.
                  </p>
                </div>
              </div>
              <SectionDefinition page="Channels" onNavigate={navigate} />
              <WebsiteChatGuide
                businessName={business.name}
                onNavigate={navigate}
              />
            </>
          )}
          {page === "Workflows" && (
            <>
              <div className="page-heading workflow-page-heading">
                <div>
                  <span className="eyebrow">DESIGN HOW YOUR CREW HELPS</span>
                  <h1>
                    Your workflows<span className="green-text">.</span>
                  </h1>
                  <p>
                    Start from a ready template, personalize each node’s job, or
                    build an advanced workflow when you need more control.
                  </p>
                </div>
                <span className="badge neutral">Templates + builder</span>
              </div>
              <SectionDefinition page="Workflows" onNavigate={navigate} />
              <WorkflowBuilder />
              <div className="info-panel workflow-info">
                <ShieldCheck size={20} />
                <p>
                  Drafts, test plans, and published versions stay in this
                  browser for practice. OpenAI, Supabase, Phorest, WhatsApp,
                  Google, and real calendar actions remain disconnected.
                </p>
              </div>
            </>
          )}
          {page === "Settings" && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">KEEP THINGS COMFORTABLE</span>
                  <h1>
                    A few simple settings<span className="green-text">.</span>
                  </h1>
                  <p>Your demo, your pace.</p>
                </div>
              </div>
              <SectionDefinition page="Settings" onNavigate={navigate} />
              <div className="settings-grid">
                <section className="simple-card">
                  <h3>Practice mode</h3>
                  <span className="badge">Always on in this version</span>
                  <p>
                    No login, API key, model usage, or paid service is needed
                    for this practice area. Live AI is deliberately disabled.
                  </p>
                </section>
                <section className="simple-card">
                  <h3>Privacy by simplicity</h3>
                  <p>
                    Use fictional sample information only. Free-text questions
                    and business settings are sent to this app’s server.
                    Conversation state stays in this tab’s memory and is sent to
                    this app to run each sample. Refreshing clears it. Hosting
                    providers may keep routine access logs.
                  </p>
                </section>
                <section className="simple-card">
                  <h3>Show the steps</h3>
                  <p>See which tools your assistant uses in each reply.</p>
                  <label className="toggle-line">
                    <input
                      type="checkbox"
                      checked={activityOpen}
                      onChange={(e) => setActivityOpen(e.target.checked)}
                    />{" "}
                    Show tool activity
                  </label>
                </section>
                <section className="simple-card">
                  <h3>A fresh start</h3>
                  <p>
                    Clear your disposable practice conversation and sample
                    approvals.
                  </p>
                  <button
                    className="button outline compact"
                    onClick={reset}
                    disabled={busy}
                  >
                    <RotateCcw size={16} /> Clear practice session
                  </button>
                  <p className="small-text">
                    Current session: {session?.turn ?? 0} practice turns.
                  </p>
                </section>
              </div>
            </>
          )}
          <footer className="studio-footer">
            <span>Made for a little more breathing room.</span>
            <span>Practice only · Built with LangGraph</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
