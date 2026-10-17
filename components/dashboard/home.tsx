"use client";

import Link from "next/link";
import {
  CalendarCheck,
  Check,
  ChevronRight,
  Inbox,
  MessageCircle,
  PencilLine,
  ShieldCheck,
} from "lucide-react";

import { useDashboard, useLaunchChecklist } from "./provider";
import { ButtonLink, EmptyState, Panel, Pill } from "./ui";

function greetingForNow() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function HomeView() {
  const { identity, purpose, business, conversation, hydrated, decide } =
    useDashboard();
  const { steps, done } = useLaunchChecklist();
  const pending =
    conversation.session?.approvals.filter((a) => a.status === "pending") ?? [];
  const replies = conversation.messages.filter((m) => m.role === "assistant");
  const unanswered = replies.filter(
    (m) => m.source === "No matching information",
  ).length;
  const handoffs = replies.filter(
    (m) =>
      m.activity?.some((a) => /handoff/i.test(a.label)) ||
      m.source === "Practice handoff policy",
  ).length;
  const answered = replies.filter(
    (m) =>
      m.source &&
      m.source !== "No matching information" &&
      m.source !== "Practice handoff policy",
  ).length;
  const nextStep = steps.find((s) => !s.done);
  const recent = conversation.messages
    .filter((m) => m.role === "customer")
    .slice(-3)
    .reverse();

  return (
    <div className="home" data-ready={hydrated}>
      <div className="ui-page-header home-header">
        <div>
          <h1>{greetingForNow()}</h1>
          <p>
            {done === steps.length
              ? `${identity.name} is ready for a website test run.`
              : `${done} of ${steps.length} setup steps done for ${business.name}.`}
          </p>
        </div>
        {nextStep && (
          <ButtonLink
            href={nextStep.href}
            variant="primary"
            icon={ChevronRight}
          >
            {nextStep.action}
          </ButtonLink>
        )}
      </div>

      <div className="home-top">
        <article
          className="crew-badge"
          aria-label={`${identity.name}, your assistant`}
        >
          <span className="crew-badge-clip" aria-hidden="true" />
          <div className="crew-badge-head">
            <span className="crew-badge-avatar" aria-hidden="true">
              {identity.name.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <span className="crew-badge-org">{business.name}</span>
              <h2>{identity.name}</h2>
              <span className="crew-badge-role">{purpose.label}</span>
            </div>
          </div>
          <blockquote>“{identity.greeting}”</blockquote>
          <dl className="crew-badge-facts">
            <div>
              <dt>Voice</dt>
              <dd>{identity.tone}</dd>
            </div>
            <div>
              <dt>When unsure</dt>
              <dd>{identity.fallback}</dd>
            </div>
          </dl>
          <footer>
            <span className="crew-badge-status">
              <span className="dash-status-dot" aria-hidden="true" />
              On duty in practice
            </span>
            <div>
              <ButtonLink
                href="/app/assistant"
                size="sm"
                variant="ghost"
                icon={PencilLine}
              >
                Edit
              </ButtonLink>
              <ButtonLink
                href="/app/inbox"
                size="sm"
                variant="primary"
                icon={MessageCircle}
              >
                Talk to {identity.name}
              </ButtonLink>
            </div>
          </footer>
        </article>

        <Panel title="Before you open" className="checklist">
          <div
            className="checklist-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={steps.length}
            aria-valuenow={done}
            aria-label="Setup progress"
          >
            <span style={{ width: `${(done / steps.length) * 100}%` }} />
          </div>
          <ol>
            {steps.map((step) => (
              <li key={step.id} data-done={step.done}>
                <span className="checklist-mark" aria-hidden="true">
                  {step.done ? <Check size={14} strokeWidth={3} /> : null}
                </span>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.detail}</p>
                </div>
                <Link
                  href={step.href}
                  className="checklist-link"
                  aria-label={`${step.action}: ${step.title}`}
                >
                  <ChevronRight size={17} />
                </Link>
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      <div className="home-bottom">
        <Panel
          title="Waiting for you"
          actions={
            pending.length > 0 ? (
              <Pill tone="attention">{pending.length} to review</Pill>
            ) : undefined
          }
        >
          {pending.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="Nothing to approve">
              Bookings and public replies that need your OK land here before
              anything happens.
            </EmptyState>
          ) : (
            <ul className="decision-list">
              {pending.map((approval) => (
                <li key={approval.id}>
                  <span className="decision-icon" aria-hidden="true">
                    <CalendarCheck size={18} />
                  </span>
                  <div>
                    <strong>Booking request</strong>
                    <p>
                      1 studio visit, $40. Sample request from a test
                      conversation.
                    </p>
                  </div>
                  <div className="decision-actions">
                    <button
                      type="button"
                      className="ui-btn ui-btn-ghost ui-btn-sm"
                      disabled={conversation.busy}
                      onClick={() => decide(approval.id, "reject")}
                    >
                      Decline
                    </button>
                    <button
                      type="button"
                      className="ui-btn ui-btn-primary ui-btn-sm"
                      disabled={conversation.busy}
                      onClick={() => decide(approval.id, "approve")}
                    >
                      Approve
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="This test session"
          actions={
            <ButtonLink href="/app/inbox" size="sm" variant="ghost">
              Open inbox
            </ButtonLink>
          }
        >
          <dl className="session-stats">
            <div>
              <dt>Questions asked</dt>
              <dd>
                {
                  conversation.messages.filter((m) => m.role === "customer")
                    .length
                }
              </dd>
            </div>
            <div>
              <dt>Answered from your facts</dt>
              <dd>{answered}</dd>
            </div>
            <div>
              <dt>Didn’t know</dt>
              <dd data-warn={unanswered > 0}>{unanswered}</dd>
            </div>
            <div>
              <dt>Passed to a person</dt>
              <dd>{handoffs}</dd>
            </div>
          </dl>
          {recent.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="No test conversations yet"
              action={
                <ButtonLink href="/app/inbox" size="sm" variant="secondary">
                  Ask a first question
                </ButtonLink>
              }
            >
              Try the questions your customers ask most.
            </EmptyState>
          ) : (
            <ul className="recent-list">
              {recent.map((m) => (
                <li key={m.id}>
                  <MessageCircle size={15} aria-hidden="true" />
                  <span>{m.text}</span>
                  <time dateTime={new Date(m.at).toISOString()}>
                    {new Date(m.at).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
