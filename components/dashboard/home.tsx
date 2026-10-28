"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  CalendarCheck,
  Check,
  ChevronRight,
  Circle,
  FlaskConical,
  GraduationCap,
  Hand,
  UserPlus,
  MessageCircle,
  ShieldCheck,
  Users,
} from "lucide-react";

import { crewJobs, receptionistSkills } from "@/lib/crew";
import { UNANSWERED } from "./chat-thread";
import { PublicReplyCard, usePublicReplies } from "./connections";
import { useDashboard, useLaunchChecklist } from "./provider";
import { CrewAvatar, type CrewRole } from "@/components/crew-avatar";
import { ButtonLink, EmptyState, Panel, Pill } from "./ui";

// Jobs that are not hired yet still get a recognisable silhouette.
const jobRole: Record<string, CrewRole> = {
  receptionist: "receptionist",
  reviews: "reputation",
  phone: "generic",
  inbox: "inbox",
  booking: "booking",
};

function greetingForNow() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function HomeView() {
  const {
    identity,
    business,
    conversation,
    hydrated,
    decide,
    decideLive,
    decideStored,
    crew,
    account,
    needsYou: server,
    threads,
    knowledge,
    markLead,
  } = useDashboard();
  const { steps, done } = useLaunchChecklist();
  const { refreshThreads } = useDashboard();
  useEffect(() => {
    void refreshThreads();
  }, [refreshThreads]);
  // Real customer chats and practice chats are counted separately, so a busy
  // afternoon of testing never looks like real demand.
  const realThreads = threads.filter((t) => t.channel !== "test");
  const testThreads = threads.filter((t) => t.channel === "test");
  const skills = crew.members[0].skills;
  const signedIn = account.status === "signed_in" && server !== null;
  const taught = new Set(knowledge.sources.map((s) => s.title.trim().toLowerCase()));

  // Practice approvals live in this tab only; live approvals come from the server.
  const approvals = [
    ...(conversation.session?.approvals ?? [])
      .filter((a) => a.status === "pending")
      .map((a) => ({
        key: a.id,
        title: "Approve a practice booking",
        detail: "Sample booking from a practice chat. Nothing is booked for real.",
        onDecide: (value: "approve" | "reject") => void decide(a.id, value),
      })),
    ...(signedIn
      ? server.approvals.map((a) => ({
          key: a.id,
          title: "Approve a booking request",
          detail: `${a.summary}. From “${a.conversationTitle}”.`,
          onDecide: (value: "approve" | "reject") => void decideStored(a.id, value),
        }))
      : conversation.messages.flatMap((m) =>
          (m.liveApprovals ?? [])
            .filter((a) => a.status === "pending")
            .map((a) => ({
              key: a.id,
              title: "Approve a booking request",
              detail: `${a.summary}. From a live AI test chat.`,
              onDecide: (value: "approve" | "reject") => decideLive(m.id, a.id, value),
            })),
        )),
  ];

  // Questions the crew couldn't answer and nobody has taught yet.
  const unanswered: string[] = [];
  const addQuestion = (q: string | undefined) => {
    const clean = q?.trim();
    if (clean && !taught.has(clean.toLowerCase()) && !unanswered.some((u) => u.toLowerCase() === clean.toLowerCase()))
      unanswered.push(clean);
  };
  if (signedIn) server.unanswered.forEach((u) => addQuestion(u.question));
  [...conversation.messages].reverse().forEach((m, i, list) => {
    if (m.role !== "assistant" || m.source !== UNANSWERED) return;
    addQuestion(m.question ?? list.slice(i + 1).find((c) => c.role === "customer")?.text);
  });
  const handoffs = signedIn ? server.handoffs : [];

  const replies = conversation.messages.filter((m) => m.role === "assistant");
  const questions = conversation.messages.filter((m) => m.role === "customer").length;
  const handedOff = replies.filter(
    (m) => m.activity?.some((a) => /handoff|person/i.test(a.label)) || m.source === "Practice handoff policy",
  ).length;
  const answered = replies.filter(
    (m) => m.source && m.source !== UNANSWERED && m.source !== "Practice handoff policy",
  ).length;
  const leads = signedIn ? server.leads : [];
  const publicReplies = usePublicReplies();
  const needsYou =
    approvals.length + unanswered.length + handoffs.length + leads.length + publicReplies.items.length;
  const nextStep = steps.find((s) => !s.done);
  const [setupOpen, setSetupOpen] = useState(false);
  const skillsOn = receptionistSkills.filter((s) => !s.comingSoon && skills[s.id] !== "off");

  return (
    <div className="home" data-ready={hydrated}>
      <div className="ui-page-header home-header">
        <div>
          <h1>{greetingForNow()}</h1>
          <p>
            {needsYou > 0
              ? `${needsYou} thing${needsYou === 1 ? "" : "s"} need${needsYou === 1 ? "s" : ""} you today.`
              : questions > 0
                ? `Your crew handled ${questions} test question${questions === 1 ? "" : "s"}. Nothing needs you.`
                : `Your crew at ${business.name} is ready. Nothing needs you.`}
          </p>
        </div>
        <ButtonLink href="/app/conversations" variant="primary" icon={MessageCircle}>
          Test a chat
        </ButtonLink>
      </div>

      {nextStep && (
        <div className="setup-block">
        <Link href={nextStep.href} className="setup-bar">
          <span className="setup-bar-count">
            {done}/{steps.length}
          </span>
          <span className="setup-bar-text">
            <strong>Setup: {nextStep.title}</strong>
            <small>{nextStep.detail}</small>
          </span>
          <span
            className="setup-bar-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={steps.length}
            aria-valuenow={done}
            aria-label="Setup progress"
          >
            <span style={{ width: `${(done / steps.length) * 100}%` }} />
          </span>
          <span className="setup-bar-action">
            {nextStep.action} <ChevronRight size={16} aria-hidden="true" />
          </span>
        </Link>
        {/*
          The bar names only the next step, so the rest of setup — and which
          parts are already done — was invisible. Collapsed by default: the
          next thing to do stays the loudest item on the page.
        */}
        <button
          type="button"
          className="setup-toggle"
          aria-expanded={setupOpen}
          aria-controls="setup-steps"
          onClick={() => setSetupOpen((open) => !open)}
        >
          {setupOpen
            ? "Hide the rest of setup"
            : `Show all ${steps.length} setup steps`}
        </button>
        {setupOpen && (
          <ul className="setup-steps" id="setup-steps">
            {steps.map((step) => (
              <li key={step.id} data-done={step.done}>
                {step.done ? (
                  <Check size={15} aria-hidden="true" />
                ) : (
                  <Circle size={15} aria-hidden="true" />
                )}
                <Link href={step.href}>
                  <strong>{step.title}</strong>
                  <small>{step.detail}</small>
                </Link>
                <span className="setup-steps-state">
                  {step.done ? "Done" : step.action}
                </span>
              </li>
            ))}
          </ul>
        )}
        </div>
      )}

      <div className="today-grid">
        <Panel
          title="Needs you"
          className="needs-you"
          actions={needsYou > 0 ? <Pill tone="attention">{needsYou} open</Pill> : undefined}
        >
          {needsYou === 0 ? (
            <EmptyState icon={ShieldCheck} title="All clear">
              Booking requests waiting for your OK and questions your crew couldn’t answer show up here.
            </EmptyState>
          ) : (
            <ul className="decision-list">
              {approvals.map((approval) => (
                <li key={approval.key}>
                  <span className="decision-icon" aria-hidden="true">
                    <CalendarCheck size={18} />
                  </span>
                  <div>
                    <strong>{approval.title}</strong>
                    <p>{approval.detail}</p>
                  </div>
                  <div className="decision-actions">
                    <button
                      type="button"
                      className="ui-btn ui-btn-ghost ui-btn-sm"
                      disabled={conversation.busy}
                      onClick={() => approval.onDecide("reject")}
                    >
                      Decline
                    </button>
                    <button
                      type="button"
                      className="ui-btn ui-btn-primary ui-btn-sm"
                      disabled={conversation.busy}
                      onClick={() => approval.onDecide("approve")}
                    >
                      Approve
                    </button>
                  </div>
                </li>
              ))}
              {unanswered.slice(0, 5).map((question) => (
                <li key={question}>
                  <span className="decision-icon" data-tone="teach" aria-hidden="true">
                    <GraduationCap size={18} />
                  </span>
                  <div>
                    <strong>“{question}”</strong>
                    <p>{identity.name} didn’t know this. Teach it once and every agent can use it.</p>
                  </div>
                  <div className="decision-actions">
                    <ButtonLink href={`/app/knowledge?teach=${encodeURIComponent(question)}`} size="sm" variant="secondary">
                      Teach this answer
                    </ButtonLink>
                  </div>
                </li>
              ))}
              {leads.map((lead) => (
                <li key={lead.id} className="lead-item">
                  <span className="decision-icon" data-tone="lead" aria-hidden="true">
                    <UserPlus size={18} />
                  </span>
                  <div>
                    <strong>
                      {lead.name}: {lead.interest}
                    </strong>
                    <p className="lead-contact">
                      {lead.phone && <a href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`}>{lead.phone}</a>}
                      {lead.email && <a href={`mailto:${lead.email}`}>{lead.email}</a>}
                    </p>
                  </div>
                  <div className="decision-actions">
                    {lead.conversationId && (
                      <ButtonLink href={`/app/conversations?c=${lead.conversationId}`} size="sm" variant="ghost">
                        Open chat
                      </ButtonLink>
                    )}
                    <button
                      type="button"
                      className="ui-btn ui-btn-primary ui-btn-sm"
                      onClick={() => void markLead(lead.id, "contacted")}
                    >
                      Contacted
                    </button>
                  </div>
                </li>
              ))}
              {handoffs.map((h) => (
                <li key={h.conversationId}>
                  <span className="decision-icon" data-tone="teach" aria-hidden="true">
                    <Hand size={18} />
                  </span>
                  <div>
                    <strong>A customer needs a person</strong>
                    <p>“{h.title}”</p>
                  </div>
                  <div className="decision-actions">
                    <ButtonLink href={`/app/conversations?c=${h.conversationId}`} size="sm" variant="secondary">
                      Open chat
                    </ButtonLink>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {publicReplies.items.length > 0 && (
            <ul className="public-reply-list">
              {publicReplies.items.slice(0, 5).map((item) => (
                <PublicReplyCard
                  key={item.id}
                  item={item}
                  onDone={(id) => publicReplies.setItems((list) => list.filter((i) => i.id !== id))}
                />
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={signedIn ? "Real customers" : "Test chats so far"}>
          {signedIn ? (
            <>
              {/* Counts here are real customers only. Test chats are counted
                  separately below, so practice never inflates them. */}
              <dl className="session-stats">
                <div>
                  <dt>Live now</dt>
                  <dd>{realThreads.filter((t) => t.status === "open").length}</dd>
                </div>
                <div>
                  <dt>Waiting for you</dt>
                  <dd data-warn={approvals.length > 0}>{realThreads.filter((t) => t.status === "waiting").length}</dd>
                </div>
                <div>
                  <dt>Didn’t know</dt>
                  <dd data-warn={unanswered.length > 0}>{unanswered.length}</dd>
                </div>
                <div>
                  <dt>To a person</dt>
                  <dd>{realThreads.filter((t) => t.status === "handoff").length}</dd>
                </div>
              </dl>
              <p className="today-note">
                <FlaskConical size={14} aria-hidden="true" />{" "}
                {testThreads.length === 0
                  ? "No test chats saved. Practice chats never count as real customers."
                  : `Plus ${testThreads.length} saved test chat${testThreads.length === 1 ? "" : "s"}, kept apart from real customers.`}
              </p>
            </>
          ) : (
            <dl className="session-stats">
              <div>
                <dt>Questions</dt>
                <dd>{questions}</dd>
              </div>
              <div>
                <dt>Answered</dt>
                <dd>{answered}</dd>
              </div>
              <div>
                <dt>Didn’t know</dt>
                <dd data-warn={unanswered.length > 0}>{unanswered.length}</dd>
              </div>
              <div>
                <dt>To a person</dt>
                <dd>{handedOff}</dd>
              </div>
            </dl>
          )}
          <p className="today-note">
            {signedIn
              ? "Test chats are counted now; website chats join them once your chat goes live."
              : "Sign in to keep test chats. Real customer numbers appear once your website chat goes live."}
          </p>
        </Panel>
      </div>

      <section className="crew-strip" aria-labelledby="crew-strip-title">
        <header>
          <h2 id="crew-strip-title">Your crew</h2>
          <ButtonLink href="/app/crew" size="sm" variant="ghost" icon={Users}>
            Manage crew
          </ButtonLink>
        </header>
        <div className="crew-strip-row">
          <Link href="/app/crew/receptionist" className="crew-tile" data-active="true">
            <span className="crew-tile-avatar" aria-hidden="true">
              <CrewAvatar role="receptionist" size={32} />
            </span>
            <span className="crew-tile-text">
              <strong>{identity.name}</strong>
              <small>Receptionist</small>
            </span>
            <span className="crew-tile-status">
              <span className="dash-status-dot" aria-hidden="true" /> On duty
            </span>
            <span className="crew-tile-skills">
              {skillsOn.map((s) => (
                <span key={s.id}>{s.title}</span>
              ))}
            </span>
          </Link>
          <Link href="/app/crew/reputation" className="crew-tile" data-active="true">
            <span className="crew-tile-avatar" aria-hidden="true">
              <CrewAvatar role="reputation" size={32} />
            </span>
            <span className="crew-tile-text">
              <strong>Reputation manager</strong>
              <small>Reviews and comments</small>
            </span>
            <span className="crew-tile-status">
              <span className="dash-status-dot" aria-hidden="true" /> Asks you first
            </span>
          </Link>
          {crewJobs
            .filter((j) => !j.available)
            .map((job) => {
              return (
                <div className="crew-tile" data-active="false" key={job.job}>
                  <span className="crew-tile-avatar" aria-hidden="true">
                    <CrewAvatar role={jobRole[job.job] ?? "generic"} state="offline" size={32} />
                  </span>
                  <span className="crew-tile-text">
                    <strong>{job.title}</strong>
                    <small>{job.channels}</small>
                  </span>
                  <Pill tone="neutral">Coming soon</Pill>
                </div>
              );
            })}
        </div>
      </section>
    </div>
  );
}
