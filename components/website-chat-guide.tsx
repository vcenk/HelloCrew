"use client";

import { useState } from "react";
import {
  ArrowRight,
  Bot,
  Check,
  Copy,
  Code2,
  ExternalLink,
  Globe,
  LockKeyhole,
  MessageCircle,
  Palette,
  Phone,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

import {
  getAssistantPurposePreset,
  type AssistantIdentity,
} from "@/lib/assistant";
import type { BusinessProfile } from "@/lib/business";
import type { WorkflowReadiness } from "@/lib/workflow-readiness";
import { DEMO_WIDGET_INSTALLATION_ID } from "@/lib/widget";

type NavigateTarget = "Your assistant" | "Workflows" | "Conversations";

type WebsiteChatGuideProps = {
  business: BusinessProfile;
  conversationReviewed: boolean;
  identity: AssistantIdentity;
  onNavigate: (target: NavigateTarget) => void;
  workflowReadiness: WorkflowReadiness;
};

const exampleSnippet = `<script
  async
  src="https://YOUR-HELLOCREW-DOMAIN/widget.js"
  data-installation="${DEMO_WIDGET_INSTALLATION_ID}"
></script>`;

const installationSteps = [
  {
    number: "01",
    title: "Publish a safe version",
    description:
      "Freeze the approved knowledge and workflow into one version for the website.",
  },
  {
    number: "02",
    title: "Create an installation ID",
    description:
      "Generate a public identifier that cannot access private dashboard data.",
  },
  {
    number: "03",
    title: "Add the website snippet",
    description:
      "Paste one script before the closing body tag or use a platform guide.",
  },
  {
    number: "04",
    title: "Verify the live widget",
    description:
      "Check the allowed domain, greeting, answers, handoff, and mobile layout.",
  },
];

export function WebsiteChatGuide({
  business,
  conversationReviewed,
  identity,
  onNavigate,
  workflowReadiness,
}: WebsiteChatGuideProps) {
  const [previewOpen, setPreviewOpen] = useState(true);
  const [snippetCopyState, setSnippetCopyState] = useState<
    "idle" | "copied" | "error"
  >("idle");
  const purpose =
    getAssistantPurposePreset(identity.purpose) ??
    getAssistantPurposePreset("custom")!;
  const knowledgeFactCount =
    (business.hours.trim() ? 1 : 0) +
    business.services.length +
    business.faqs.length;
  const knowledgeReady = knowledgeFactCount > 0;
  const workflowPublished = workflowReadiness.status === "published";
  const workflowStatus = workflowPublished
    ? `Published v${workflowReadiness.version}`
    : workflowReadiness.status === "draft"
      ? "Draft saved"
      : "Not saved";
  const workflowDescription = workflowPublished
    ? `${workflowReadiness.name} is published for this practice browser.`
    : workflowReadiness.status === "draft"
      ? `${workflowReadiness.name} is saved as a draft. Publish a version before launch.`
      : "Choose and save a workflow, then publish a version before launch.";
  const readinessSteps = [
    {
      number: "01",
      title: "Identity",
      description: `${identity.name} is configured as a ${purpose.label.toLowerCase()} with an editable greeting and safe fallback.`,
      action: "Review in Your assistant",
      target: "Your assistant" as const,
      status: "Configured",
      state: "ready" as const,
      ready: true,
    },
    {
      number: "02",
      title: "Knowledge",
      description: knowledgeReady
        ? `${knowledgeFactCount} approved practice fact${knowledgeFactCount === 1 ? "" : "s"} available from hours, services, and FAQs.`
        : "Add at least one approved business fact for grounded answers.",
      action: "Review in Your assistant",
      target: "Your assistant" as const,
      status: knowledgeReady
        ? "Practice knowledge available"
        : "No facts added",
      state: knowledgeReady ? ("ready" as const) : ("missing" as const),
      ready: knowledgeReady,
    },
    {
      number: "03",
      title: "Workflow",
      description: workflowDescription,
      action: "Review in Workflows",
      target: "Workflows" as const,
      status: workflowStatus,
      state: workflowPublished
        ? ("ready" as const)
        : workflowReadiness.status === "draft"
          ? ("attention" as const)
          : ("missing" as const),
      ready: workflowPublished,
    },
    {
      number: "04",
      title: "Conversation test",
      description: conversationReviewed
        ? "A practice reply has been reviewed in this disposable session."
        : "Send a practice message and review the reply before launch.",
      action: "Review in Conversations",
      target: "Conversations" as const,
      status: conversationReviewed ? "Test reviewed" : "Not reviewed",
      state: conversationReviewed ? ("ready" as const) : ("missing" as const),
      ready: conversationReviewed,
    },
  ];
  const readyCount = readinessSteps.filter((step) => step.ready).length;

  async function copyPracticeSnippet() {
    try {
      const snippet = exampleSnippet.replace(
        "https://YOUR-HELLOCREW-DOMAIN",
        window.location.origin,
      );
      await navigator.clipboard.writeText(snippet);
      setSnippetCopyState("copied");
      window.setTimeout(() => setSnippetCopyState("idle"), 1800);
    } catch {
      setSnippetCopyState("error");
    }
  }

  return (
    <div className="website-chat-guide">
      <section className="channel-spotlight">
        <div className="channel-spotlight-copy">
          <span className="channel-kicker">
            <Globe size={16} /> Website chat · first channel
          </span>
          <h2>
            From your knowledge
            <br />
            to a helpful <em>hello.</em>
          </h2>
          <p>
            This section owns the website preview, publishing status, and
            installation. Earlier work appears only as readiness checks.
          </p>
          <div className="channel-assistant-chip">
            <span>
              <Bot size={17} aria-hidden="true" />
            </span>
            <div>
              <small>ASSISTANT IN THIS CHANNEL</small>
              <strong>{identity.name}</strong>
              <p>
                {purpose.label} · {identity.tone}
              </p>
            </div>
          </div>
          <div className="channel-status-line">
            <span>
              <Check size={15} /> {readyCount} of 4 practice inputs ready
            </span>
            <span>
              <LockKeyhole size={15} /> Live embed locked
            </span>
          </div>
        </div>

        <div className="widget-stage" aria-label="Website chat preview">
          <div className="widget-browser-bar" aria-hidden="true">
            <span />
            <span />
            <span />
            <div>yourwebsite.com</div>
          </div>
          <div className="widget-site-preview">
            <span className="widget-site-mark">{business.name.charAt(0)}</span>
            <div>
              <small>WELCOME TO</small>
              <strong>{business.name}</strong>
              <p>Thoughtful service, with a little more breathing room.</p>
            </div>
          </div>
          {previewOpen ? (
            <div className="widget-window" id="website-chat-preview">
              <div className="widget-window-head">
                <span className="widget-bot-mark">
                  <Sparkles size={17} />
                </span>
                <div>
                  <strong>{identity.name}</strong>
                  <small>
                    {business.name} · {purpose.label}
                  </small>
                </div>
                <button
                  type="button"
                  aria-label="Close website chat preview"
                  onClick={() => setPreviewOpen(false)}
                >
                  <X size={17} />
                </button>
              </div>
              <div className="widget-window-body">
                <span className="widget-mini-bot">✳</span>
                <p>{identity.greeting}</p>
                <button type="button">When are you open?</button>
                <button type="button">What services do you offer?</button>
              </div>
              <div className="widget-window-input">
                <span>Type a question…</span>
                <ArrowRight size={16} />
              </div>
            </div>
          ) : null}
          <button
            type="button"
            className="widget-launcher"
            aria-expanded={previewOpen}
            aria-controls="website-chat-preview"
            onClick={() => setPreviewOpen((open) => !open)}
          >
            {previewOpen ? <X size={21} /> : <MessageCircle size={21} />}
            <span>{previewOpen ? "Close preview" : "Show preview"}</span>
          </button>
        </div>
      </section>

      <section
        className="channel-prerequisites"
        aria-labelledby="channel-prerequisites-title"
      >
        <div className="channel-section-heading">
          <div>
            <span className="eyebrow">READINESS FROM OTHER SECTIONS</span>
            <h2 id="channel-prerequisites-title">
              Check the inputs. Edit them where they belong.
            </h2>
          </div>
          <span className="badge neutral">
            {readyCount} of 4 practice inputs ready
          </span>
        </div>
        <ol className="channel-prerequisite-list">
          {readinessSteps.map((step) => (
            <li className="channel-prerequisite" key={step.number}>
              <span className="channel-step-number">{step.number}</span>
              <div className="channel-step-copy">
                <div className="channel-prerequisite-title">
                  <h3>{step.title}</h3>
                  <span className={step.state}>{step.status}</span>
                </div>
                <p>{step.description}</p>
                <button
                  type="button"
                  className="channel-step-action"
                  onClick={() => onNavigate(step.target)}
                >
                  {step.action} <ArrowRight size={15} />
                </button>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section
        className="channel-journey"
        aria-labelledby="website-setup-title"
      >
        <div className="channel-section-heading">
          <div>
            <span className="eyebrow">THIS SECTION’S JOB</span>
            <h2 id="website-setup-title">
              Publish and install the website chat.
            </h2>
          </div>
          <span className="badge neutral">Secure backend required</span>
        </div>
        <ol className="channel-steps">
          {installationSteps.map((step) => (
            <li className="channel-step locked" key={step.number}>
              <span className="channel-step-number">{step.number}</span>
              <div className="channel-step-copy">
                <div>
                  <h3>{step.title}</h3>
                  <span className="channel-step-state">Planned</span>
                </div>
                <p>{step.description}</p>
                <span className="channel-step-locked">
                  <LockKeyhole size={14} /> Available after secure publishing
                </span>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="embed-explainer">
        <div className="embed-explainer-copy">
          <span className="embed-icon">
            <Code2 size={22} />
          </span>
          <span className="eyebrow">WORKING PRACTICE INSTALLATION</span>
          <h2>One snippet. No secret keys.</h2>
          <p>
            The loader and isolated iframe now work with a fixed public demo
            installation. Open the test website or copy the practice snippet to
            verify how installation behaves before account publishing exists.
          </p>
          <div className="embed-safety-note">
            <ShieldCheck size={18} />
            <span>
              The demo ID exposes fictional practice answers only. Production
              IDs will be server-owned, domain-bound, and separate from model
              provider credentials.
            </span>
          </div>
        </div>
        <div className="embed-code-card">
          <div className="embed-code-head">
            <span>Practice snippet</span>
            <span className="badge neutral">Public demo fixture</span>
          </div>
          <pre>
            <code>{exampleSnippet}</code>
          </pre>
          <div className="embed-code-actions">
            <button
              className="button outline compact"
              type="button"
              onClick={() => void copyPracticeSnippet()}
            >
              <Copy size={15} />
              {snippetCopyState === "copied"
                ? "Copied"
                : snippetCopyState === "error"
                  ? "Copy unavailable"
                  : "Copy practice snippet"}
            </button>
            <a
              className="button outline compact"
              href="/widget-test"
              target="_blank"
              rel="noreferrer"
            >
              Open test website <ExternalLink size={15} />
            </a>
          </div>
        </div>
      </section>

      <section
        className="future-channels"
        aria-labelledby="future-channels-title"
      >
        <div>
          <span className="eyebrow">LATER, WHEN THE FIRST HELLO WORKS</span>
          <h2 id="future-channels-title">More places to meet people.</h2>
        </div>
        <article>
          <MessageCircle size={22} />
          <div>
            <h3>WhatsApp</h3>
            <p>Messaging provider, consent, templates, and webhook safety.</p>
          </div>
          <span>Later</span>
        </article>
        <article>
          <Phone size={22} />
          <div>
            <h3>Phone</h3>
            <p>Voice provider, transfers, interruption, and call disclosure.</p>
          </div>
          <span>Later</span>
        </article>
        <article>
          <Palette size={22} />
          <div>
            <h3>Theme controls</h3>
            <p>Brand color, greeting, position, and launcher style.</p>
          </div>
          <span>With embed</span>
        </article>
      </section>

      <div className="info-panel channel-safety-panel">
        <ShieldCheck size={20} />
        <p>
          The installation lab uses one fixed public demo ID and fictional
          server-owned facts. It does not publish this browser’s assistant,
          authorize a customer domain, connect an AI provider, or send messages
          outside this practice app.
        </p>
      </div>
    </div>
  );
}
