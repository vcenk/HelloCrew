"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  ChevronRight,
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
  Globe,
  Phone,
  X,
  LoaderCircle,
  Workflow,
} from "lucide-react";
import { KnowledgeManager } from "./knowledge-manager";
import { sampleBusiness, type BusinessProfile } from "@/lib/business";
import { readiness } from "@/lib/readiness";
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
const pages = [
  { name: "Home", icon: Home },
  { name: "Conversations", icon: MessageCircle },
  { name: "Your assistant", icon: SlidersHorizontal },
  { name: "Workflows", icon: Workflow },
  { name: "Channels", icon: Radio },
  { name: "Settings", icon: Settings },
] as const;
type Page = (typeof pages)[number]["name"];
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
  const [showWelcome, setShowWelcome] = useState(true);
  const [activityOpen, setActivityOpen] = useState(true);
  const lock = useRef(false);
  const end = useRef<HTMLDivElement>(null);
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
    setPage("Conversations");
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
    setSession(fresh());
    setMessages([]);
    setDraftMessage("");
    setError("");
  }
  const pending =
    session?.approvals.filter((a) => a.status === "pending") ?? [];
  return (
    <div className="studio-shell">
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
          {pages.map((p) => (
            <button
              key={p.name}
              className={page === p.name ? "active" : ""}
              onClick={() => setPage(p.name)}
              aria-current={page === p.name ? "page" : undefined}
            >
              <p.icon size={20} />
              {p.name}
              {p.name === "Conversations" && messages.length > 0 && (
                <span className="nav-count">
                  {messages.filter((m) => m.role === "customer").length}
                </span>
              )}
            </button>
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
          <span>{page}</span>
          <div>
            <span className="badge">
              <span className="dot" /> Practice mode
            </span>
            <span className="avatar">You</span>
          </div>
        </header>
        <main className="studio-content">
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
                  <span className="eyebrow">YOUR LITTLE HELPING HAND</span>
                  <h1>
                    Welcome to your crew<span className="green-text">.</span>
                  </h1>
                  <p>Let’s see what a little help could look like.</p>
                </div>
                <span className="heading-flower">✳</span>
              </div>
              {showWelcome && (
                <section className="welcome-card">
                  <button
                    className="icon-button dismiss"
                    aria-label="Dismiss welcome"
                    onClick={() => setShowWelcome(false)}
                  >
                    <X size={18} />
                  </button>
                  <div>
                    <span className="badge pale">
                      Start here · about 1 minute
                    </span>
                    <h2>
                      Meet your assistant.
                      <br />
                      Try a conversation.
                    </h2>
                    <p>
                      Choose a sample question. Your assistant will find an
                      answer, show its work, and check with you before the next
                      step.
                    </p>
                    <button
                      className="button dark"
                      onClick={() => run("hours")}
                    >
                      Say your first hello <ArrowRight size={18} />
                    </button>
                  </div>
                  <div className="welcome-art">
                    <Buddy />
                    <span className="welcome-spark">✦</span>
                  </div>
                </section>
              )}
              <div className="section-heading">
                <h2>A few things to try</h2>
                <span>No setup needed</span>
              </div>
              <div className="scenario-grid">
                {scenarios.map((s) => (
                  <button
                    key={s.id}
                    className="scenario-card"
                    onClick={() => run(s.id)}
                    disabled={busy}
                  >
                    <span className={`scenario-icon ${s.id}`}>
                      <s.icon size={22} />
                    </span>
                    <h3>{s.label}</h3>
                    <p>{s.description}</p>
                    <span className="scenario-bottom">
                      Try it out <ArrowUpRight size={19} />
                    </span>
                  </button>
                ))}
              </div>
              <div className="home-bottom">
                <section className="simple-card">
                  <span className="card-icon">
                    <Radio size={20} />
                  </span>
                  <h3>One home. A few ways to say hello.</h3>
                  <p>
                    The website demo is ready to explore. WhatsApp and phone are
                    future connections.
                  </p>
                  <button
                    className="text-link"
                    onClick={() => setPage("Channels")}
                  >
                    Explore channels <ArrowRight size={16} />
                  </button>
                </section>
                <section className="simple-card">
                  <span className="card-icon">
                    <ShieldCheck size={20} />
                  </span>
                  <h3>You’re in the driver’s seat.</h3>
                  <p>
                    See which tools are used, review sample approvals, and start
                    over whenever you like.
                  </p>
                  <button
                    className="text-link"
                    onClick={() => setPage("Your assistant")}
                  >
                    Meet your assistant <ArrowRight size={16} />
                  </button>
                </section>
              </div>
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
                  <p>Curate the facts your future crew is allowed to use.</p>
                </div>
              </div>
              <div className="assistant-overview">
                <span className="assistant-portrait">✳</span>
                <div>
                  <span className="badge">Practice assistant</span>
                  <h2>Friendly. Clear. Careful.</h2>
                  <p>
                    Answers only from approved business knowledge. Drafts and
                    outdated sources stay out of retrieval, while risky actions
                    still wait for approval.
                  </p>
                </div>
              </div>
              <section className="simple-card readiness-card">
                <span className="badge">{readiness.label}</span>
                <h2>Your next steps</h2>
                <ol>
                  {readiness.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <p>
                  Supabase credentials are configured locally, but tenant-safe
                  persistence stays off until authentication and RLS policies
                  are installed and verified.
                </p>
              </section>
              <KnowledgeManager
                business={business}
                disabled={busy}
                onSave={setBusiness}
              />
              <div className="settings-grid">
                <section className="simple-card">
                  <h3>What it knows</h3>
                  <dl>
                    <dt>Example business</dt>
                    <dd>{business.name}</dd>
                    <dt>Sample hours</dt>
                    <dd>{business.hours}</dd>
                    <dt>Sample service</dt>
                    <dd>
                      {business.services
                        .map((s) => `${s.name}: ${s.price}`)
                        .join(" · ")}
                    </dd>
                  </dl>
                </section>
                <section className="simple-card">
                  <h3>What it can do here</h3>
                  <ul className="check-list">
                    <li>
                      <Check /> Look up a sample FAQ
                    </li>
                    <li>
                      <Check /> Read a sample service price
                    </li>
                    <li>
                      <Check /> Ask for a practice approval
                    </li>
                    <li>
                      <Check /> Prepare a sample handoff
                    </li>
                  </ul>
                </section>
                <section className="simple-card wide">
                  <h3>Under the friendly surface</h3>
                  <p>
                    A real LangGraph StateGraph connects a deterministic
                    practice provider and typed tools. It does not call a
                    language model. Conservative free-text matching shows the
                    workflow without needing an API key.
                  </p>
                  <button
                    className="button dark compact"
                    onClick={() => setPage("Conversations")}
                  >
                    Try a conversation <ArrowRight size={16} />
                  </button>
                </section>
              </div>
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
              <div className="channel-list">
                {[
                  {
                    icon: Globe,
                    name: "Website",
                    status: "Practice available",
                    text: "Explore the sample conversation in this app. A customer-facing embed is not connected.",
                    ready: true,
                  },
                  {
                    icon: MessageCircle,
                    name: "WhatsApp",
                    status: "Not connected",
                    text: "Future adapter. No WhatsApp account or messaging service is connected.",
                    ready: false,
                  },
                  {
                    icon: Phone,
                    name: "Phone",
                    status: "Not connected",
                    text: "Future adapter. No number, calling service, or voice provider is connected.",
                    ready: false,
                  },
                ].map((c) => (
                  <section className="channel-card" key={c.name}>
                    <span className="channel-icon">
                      <c.icon size={25} />
                    </span>
                    <div>
                      <h2>{c.name}</h2>
                      <p>{c.text}</p>
                    </div>
                    <span className={`badge ${!c.ready ? "neutral" : ""}`}>
                      {c.status}
                    </span>
                    {c.ready ? (
                      <button
                        className="icon-button"
                        aria-label="Try website demo"
                        onClick={() => setPage("Conversations")}
                      >
                        <ChevronRight />
                      </button>
                    ) : (
                      <span className="future-label">Later</span>
                    )}
                  </section>
                ))}
              </div>
              <div className="info-panel">
                <ShieldCheck size={20} />
                <p>
                  Connecting a real channel will need authentication, shared
                  usage limits, durable approval records, and a provider.
                  Nothing here sends messages to real customers.
                </p>
              </div>
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
              <div className="settings-grid">
                <section className="simple-card">
                  <h3>Practice mode</h3>
                  <span className="badge">Always on in this version</span>
                  <p>
                    No login, API key, model usage, or paid service is needed for
                    this practice area. Live AI is deliberately disabled.
                  </p>
                </section>
                <section className="simple-card">
                  <h3>Owner workspace</h3>
                  <span className="badge neutral">Supabase foundation</span>
                  <p>
                    Approved owners can sign in with Google to verify their
                    protected tenant workspace. Practice drafts remain local
                    until durable saves are connected.
                  </p>
                  <Link className="button outline compact" href="/workspace">
                    Owner sign in <ArrowUpRight size={15} />
                  </Link>
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
