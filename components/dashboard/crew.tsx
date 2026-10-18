"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowUpRight,
  Check,
  Globe,
  Lock,
  MessageCircle,
  Phone,
  Star,
  Workflow,
} from "lucide-react";

import {
  assistantIdentitySchema,
  assistantPurposePresets,
  assistantTones,
  identityForPurpose,
  type AssistantIdentity,
} from "@/lib/assistant";
import {
  crewJobs,
  receptionistSkills,
  setSkillMode,
  type SkillMode,
} from "@/lib/crew";
import { WebsiteChatGuide } from "@/components/website-chat-guide";
import { ChatThread } from "./chat-thread";
import { WebsiteChatSetup } from "./website-chat";
import { useDashboard } from "./provider";
import { Button, ButtonLink, PageHeader, Pill } from "./ui";

const jobIcon = { receptionist: Globe, whatsapp: MessageCircle, reviews: Star, phone: Phone } as const;
const jobBlurb = {
  receptionist: "Answers website visitors, takes booking requests and passes tricky chats to you.",
  whatsapp: "The same receptionist, answering on your WhatsApp Business number.",
  reviews: "Drafts replies to new Google reviews for you to approve.",
  phone: "Picks up calls, answers common questions and takes messages.",
} as const;

const modeLabel: Record<SkillMode, string> = { off: "Off", ask: "Ask me first", auto: "On its own" };

export function CrewView() {
  const { identity, crew } = useDashboard();
  const skills = crew.members[0].skills;
  return (
    <div className="crew-page">
      <PageHeader
        title="Crew"
        description="Each agent has one job. They all share your knowledge, and you decide what each may do on its own."
      />
      <h2 className="section-title">On your crew</h2>
      <Link href="/app/crew/receptionist" className="agent-card">
        <span className="agent-card-avatar" aria-hidden="true">
          {identity.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="agent-card-main">
          <div className="agent-card-title">
            <strong>{identity.name}</strong>
            <Pill tone="success">
              <span className="dash-status-dot" aria-hidden="true" /> On duty
            </Pill>
          </div>
          <small>Website receptionist · {identity.tone}</small>
          <p>“{identity.greeting}”</p>
          <ul className="agent-card-skills" aria-label="Skills">
            {receptionistSkills
              .filter((s) => !s.comingSoon)
              .map((s) => (
                <li key={s.id} data-mode={skills[s.id]}>
                  {s.title}: <b>{modeLabel[skills[s.id]]}</b>
                </li>
              ))}
          </ul>
        </div>
        <div className="agent-card-channels">
          <span>Works on</span>
          <strong>
            <Globe size={14} aria-hidden="true" /> Website chat
          </strong>
        </div>
        <ArrowUpRight size={18} className="agent-card-go" aria-hidden="true" />
      </Link>

      <h2 className="section-title">Add to your crew</h2>
      <div className="hire-grid">
        {crewJobs
          .filter((j) => !j.available)
          .map((job) => {
            const Icon = jobIcon[job.job];
            return (
              <article className="hire-card" key={job.job}>
                <span className="hire-card-icon" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <strong>{job.title}</strong>
                <p>{jobBlurb[job.job]}</p>
                <footer>
                  <small>{job.channels}</small>
                  <Pill tone="neutral">Coming soon</Pill>
                </footer>
              </article>
            );
          })}
      </div>
    </div>
  );
}

const tabs = [
  { href: "/app/crew/receptionist", label: "Skills" },
  { href: "/app/crew/receptionist/personality", label: "Personality" },
  { href: "/app/crew/receptionist/channels", label: "Channels" },
];

export function AgentLayout({ children }: { children: React.ReactNode }) {
  const { identity } = useDashboard();
  const pathname = usePathname();
  return (
    <div className="agent-page">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/app/crew">Crew</Link>
        <span aria-hidden="true">/</span>
        <span>{identity.name}</span>
      </nav>
      <header className="agent-head">
        <span className="agent-card-avatar" aria-hidden="true">
          {identity.name.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <h1>{identity.name}</h1>
          <p>Website receptionist · answers from your knowledge</p>
        </div>
        <Pill tone="success">
          <span className="dash-status-dot" aria-hidden="true" /> On duty
        </Pill>
      </header>
      <div className="tabs" role="tablist" aria-label={`${identity.name} settings`}>
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            role="tab"
            aria-selected={pathname === tab.href}
            className="tab"
          >
            {tab.label}
          </Link>
        ))}
      </div>
      <div className="agent-grid">
        <div className="agent-main">{children}</div>
        <aside className="agent-try" aria-label={`Try ${identity.name}`}>
          <ChatThread compact />
        </aside>
      </div>
    </div>
  );
}

export function SkillsTab() {
  const { crew, saveCrew, toast } = useDashboard();
  const skills = crew.members[0].skills;
  return (
    <div className="skills">
      <p className="tab-intro">
        Choose what this agent may do. <b>Ask me first</b> means it prepares the action and waits for you on Today.
      </p>
      <ul className="skill-list">
        {receptionistSkills.map((skill) => (
          <li key={skill.id} className="skill" data-coming={skill.comingSoon ?? false}>
            <div className="skill-text">
              <strong>
                {skill.title}
                {skill.comingSoon && <Pill tone="neutral">Coming soon</Pill>}
              </strong>
              <p>{skill.summary}</p>
              {skill.locked && !skill.comingSoon && (
                <small>
                  <Lock size={12} aria-hidden="true" /> {skill.locked}
                </small>
              )}
            </div>
            <div className="segmented autonomy" role="radiogroup" aria-label={`${skill.title} mode`}>
              {(["off", "ask", "auto"] as const).map((mode) => {
                const allowed = skill.allowed.includes(mode);
                return (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={skills[skill.id] === mode}
                    disabled={!allowed}
                    title={allowed ? undefined : skill.comingSoon ? "Coming soon" : skill.locked}
                    onClick={() => {
                      if (skills[skill.id] === mode) return;
                      saveCrew(setSkillMode(crew, skill.id, mode));
                      toast(`${skill.title}: ${modeLabel[mode]}`);
                    }}
                  >
                    {modeLabel[mode]}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
      <Link href="/app/workflows" className="advanced-link">
        <Workflow size={16} aria-hidden="true" />
        <span>
          <strong>Advanced workflow editor</strong>
          <small>Fine-tune each step, the questions asked and where it stops for you.</small>
        </span>
        <ArrowUpRight size={16} aria-hidden="true" />
      </Link>
    </div>
  );
}

export function PersonalityTab() {
  const { identity } = useDashboard();
  // Remount the form when the saved identity changes (e.g. synced from another tab).
  return <PersonalityForm key={JSON.stringify(identity)} identity={identity} />;
}

function PersonalityForm({ identity }: { identity: AssistantIdentity }) {
  const { saveIdentity, toast } = useDashboard();
  const [draft, setDraft] = useState<AssistantIdentity>(identity);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(identity);

  function field<K extends keyof AssistantIdentity>(key: K, value: AssistantIdentity[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setError("");
  }

  return (
    <form
      className="form-card"
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = assistantIdentitySchema.safeParse(draft);
        if (!parsed.success) {
          setError("Every field needs some text. Name up to 60 characters, greeting up to 240.");
          return;
        }
        saveIdentity(parsed.data);
        toast("Personality saved");
      }}
    >
      <div className="field">
        <label htmlFor="p-preset">Start from</label>
        <select
          id="p-preset"
          value={draft.purpose}
          onChange={(e) => {
            const next = identityForPurpose(e.target.value as AssistantIdentity["purpose"]);
            setDraft({ ...next, name: draft.name });
          }}
        >
          {assistantPurposePresets.map((p) => (
            <option key={p.purpose} value={p.purpose}>
              {p.label}
            </option>
          ))}
        </select>
        <small>Fills in a role, greeting and fallback you can then edit.</small>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="p-name">Name</label>
          <input id="p-name" maxLength={60} value={draft.name} onChange={(e) => field("name", e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="p-tone">Voice</label>
          <select id="p-tone" value={draft.tone} onChange={(e) => field("tone", e.target.value as AssistantIdentity["tone"])}>
            {assistantTones.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="p-role">What it does</label>
        <textarea id="p-role" rows={2} maxLength={180} value={draft.role} onChange={(e) => field("role", e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="p-greeting">First message</label>
        <textarea id="p-greeting" rows={2} maxLength={240} value={draft.greeting} onChange={(e) => field("greeting", e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="p-fallback">When it doesn’t know</label>
        <textarea id="p-fallback" rows={2} maxLength={280} value={draft.fallback} onChange={(e) => field("fallback", e.target.value)} />
        <small>It never guesses. This is what it says instead.</small>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <footer className="form-actions">
        <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(identity)}>
          Discard
        </Button>
        <Button type="submit" variant="primary" icon={Check} disabled={!dirty}>
          Save personality
        </Button>
      </footer>
    </form>
  );
}

const routeFor = {
  "Your assistant": "/app/crew/receptionist/personality",
  Workflows: "/app/workflows",
  Conversations: "/app/conversations",
} as const;

export function ChannelsTab() {
  const router = useRouter();
  const { business, identity, workflowReadiness, conversation, account } = useDashboard();
  const signedIn = account.status === "signed_in";
  return (
    <div className="channels-tab">
      {signedIn ? (
        <WebsiteChatSetup />
      ) : (
        <ul className="channel-list">
          <li>
            <Globe size={17} aria-hidden="true" />
            <span>
              <strong>Website chat</strong>
              <small>Sign in to get your own website chat. Below is the practice preview.</small>
            </span>
            <Pill tone="info">Practice preview</Pill>
          </li>
        </ul>
      )}
      <ul className="channel-list">
        <li data-soon="true">
          <MessageCircle size={17} aria-hidden="true" />
          <span>
            <strong>WhatsApp</strong>
            <small>Same knowledge and skills, on your business number.</small>
          </span>
          <Pill tone="neutral">Coming soon</Pill>
        </li>
      </ul>
      {!signedIn && (
        <div className="legacy-host">
          <WebsiteChatGuide
            business={business}
            conversationReviewed={conversation.messages.some((m) => m.role === "assistant")}
            identity={identity}
            onNavigate={(target) => router.push(routeFor[target])}
            workflowReadiness={workflowReadiness}
          />
        </div>
      )}
      <ButtonLink href="/app/conversations" variant="ghost" size="sm">
        See conversations
      </ButtonLink>
    </div>
  );
}
