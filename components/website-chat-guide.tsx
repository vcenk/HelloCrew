"use client";

import { useState } from "react";
import {
  ArrowRight,
  Check,
  Code2,
  Globe,
  LockKeyhole,
  MessageCircle,
  Palette,
  Phone,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

type NavigateTarget = "Your assistant" | "Workflows" | "Conversations";

type WebsiteChatGuideProps = {
  businessName: string;
  onNavigate: (target: NavigateTarget) => void;
};

const exampleSnippet = `<script
  async
  src="https://chat.hellocrew.ai/widget.js"
  data-site="created-after-publish"
></script>`;

const prerequisites: {
  number: string;
  title: string;
  description: string;
  action: string;
  target: NavigateTarget;
}[] = [
  {
    number: "01",
    title: "Knowledge",
    description:
      "Confirm the facts, policies, and approved sources this channel will use.",
    action: "Review in Your assistant",
    target: "Your assistant",
  },
  {
    number: "02",
    title: "Workflow",
    description:
      "Choose the website behavior, approvals, and human handoff path.",
    action: "Review in Workflows",
    target: "Workflows",
  },
  {
    number: "03",
    title: "Conversation test",
    description:
      "Review what visitors will read and verify the activity behind each reply.",
    action: "Review in Conversations",
    target: "Conversations",
  },
];

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
  businessName,
  onNavigate,
}: WebsiteChatGuideProps) {
  const [previewOpen, setPreviewOpen] = useState(true);

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
          <div className="channel-status-line">
            <span>
              <Check size={15} /> Practice path available
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
            <span className="widget-site-mark">{businessName.charAt(0)}</span>
            <div>
              <small>WELCOME TO</small>
              <strong>{businessName}</strong>
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
                  <strong>{businessName}</strong>
                  <small>Usually replies right away</small>
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
                <p>Hello! What can I help you find today?</p>
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
          <span className="badge neutral">Linked, not duplicated</span>
        </div>
        <ol className="channel-prerequisite-list">
          {prerequisites.map((step) => (
            <li className="channel-prerequisite" key={step.number}>
              <span className="channel-step-number">{step.number}</span>
              <div className="channel-step-copy">
                <h3>{step.title}</h3>
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

      <section className="channel-journey" aria-labelledby="website-setup-title">
        <div className="channel-section-heading">
          <div>
            <span className="eyebrow">THIS SECTION’S JOB</span>
            <h2 id="website-setup-title">Publish and install the website chat.</h2>
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
          <span className="eyebrow">WHAT INSTALLATION WILL LOOK LIKE</span>
          <h2>One snippet. No secret keys.</h2>
          <p>
            After publishing, HelloCrew will create a public installation ID.
            The owner pastes one script before their website’s closing body tag,
            or uses a future platform-specific guide.
          </p>
          <div className="embed-safety-note">
            <ShieldCheck size={18} />
            <span>
              The installation ID identifies the published assistant. It cannot
              grant dashboard access or expose private Supabase credentials.
            </span>
          </div>
        </div>
        <div className="embed-code-card">
          <div className="embed-code-head">
            <span>Example only</span>
            <span className="badge neutral">Not installable yet</span>
          </div>
          <pre>
            <code>{exampleSnippet}</code>
          </pre>
          <button className="button outline compact" type="button" disabled>
            Copy after publishing
          </button>
        </div>
      </section>

      <section className="future-channels" aria-labelledby="future-channels-title">
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
          This page is a truthful setup guide and visual preview. It does not
          create an installation ID, load a customer website, or send messages
          outside this practice app.
        </p>
      </div>
    </div>
  );
}
