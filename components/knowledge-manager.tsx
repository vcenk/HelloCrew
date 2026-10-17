"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Bot,
  Building2,
  Check,
  CircleAlert,
  Clock3,
  FileText,
  FlaskConical,
  Languages,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react";

import {
  assistantIdentitySchema,
  assistantPurposePresets,
  assistantTones,
  identityForPurpose,
  type AssistantIdentity,
} from "@/lib/assistant";
import { bookingLinkSchema, type BusinessProfile } from "@/lib/business";
import {
  businessFromKnowledge,
  countLanguageCoverage,
  knowledgeKinds,
  searchApprovedKnowledge,
  type KnowledgeKind,
  type KnowledgeLanguage,
  type KnowledgeSource,
  type KnowledgeStatus,
  type KnowledgeStore,
} from "@/lib/knowledge";
import {
  KNOWLEDGE_STORAGE_KEY,
  readKnowledgeStore,
} from "@/lib/knowledge-storage";

const languageLabels: Record<KnowledgeLanguage, string> = {
  en: "English",
  fa: "Farsi",
  zh: "Mandarin",
};
const kindLabels: Record<KnowledgeKind, string> = {
  hours: "Hours",
  service: "Service",
  faq: "FAQ",
  policy: "Policy",
  document: "Document",
};

type SourceDraft = {
  kind: KnowledgeKind;
  language: KnowledgeLanguage;
  title: string;
  content: string;
  price: string;
};

const emptyDraft: SourceDraft = {
  kind: "faq",
  language: "en",
  title: "",
  content: "",
  price: "",
};

export function AssistantSetup({
  business,
  disabled,
  identity,
  onIdentitySave,
  onSave,
}: {
  business: BusinessProfile;
  disabled: boolean;
  identity: AssistantIdentity;
  onIdentitySave: (identity: AssistantIdentity) => void;
  onSave: (business: BusinessProfile) => void;
}) {
  const [store, setStore] = useState(() => readKnowledgeStore(business));
  const [activeStep, setActiveStep] = useState<
    "identity" | "business" | "knowledge"
  >("identity");
  const [identityDraft, setIdentityDraft] = useState(identity);
  const [filter, setFilter] = useState<"all" | KnowledgeKind>("all");
  const [showComposer, setShowComposer] = useState(false);
  const [draft, setDraft] = useState<SourceDraft>(emptyDraft);
  const [profileDraft, setProfileDraft] = useState(store.profile);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("Is parking available?");
  const [queryLanguage, setQueryLanguage] = useState<KnowledgeLanguage>("en");
  const [hasTested, setHasTested] = useState(false);

  useEffect(() => {
    localStorage.setItem(KNOWLEDGE_STORAGE_KEY, JSON.stringify(store));
    onSave(businessFromKnowledge(store));
  }, [onSave, store]);

  const coverage = useMemo(() => countLanguageCoverage(store), [store]);
  const counts = useMemo(
    () => ({
      approved: store.sources.filter((source) => source.status === "approved")
        .length,
      draft: store.sources.filter((source) => source.status === "draft").length,
      outdated: store.sources.filter((source) => source.status === "outdated")
        .length,
    }),
    [store],
  );
  const visibleSources = store.sources.filter(
    (source) => filter === "all" || source.kind === filter,
  );
  const matches = hasTested
    ? searchApprovedKnowledge(store, query, queryLanguage)
    : [];
  const selectedPurpose =
    assistantPurposePresets.find(
      (preset) => preset.purpose === identityDraft.purpose,
    ) ?? assistantPurposePresets[1];

  function updateStore(next: KnowledgeStore, message?: string) {
    setStore(next);
    setNotice(message ?? "");
    setHasTested(false);
  }

  function saveIdentity(): boolean {
    const parsed = assistantIdentitySchema.safeParse(identityDraft);
    if (!parsed.success) {
      setNotice(
        parsed.error.issues[0]?.message ??
          "Complete each assistant identity field before saving.",
      );
      return false;
    }
    onIdentitySave(parsed.data);
    setNotice("Assistant identity saved in this practice browser.");
    return true;
  }

  function addSource() {
    const title = draft.title.trim();
    const content = draft.content.trim();
    if (
      !title ||
      !content ||
      (draft.kind === "service" && !draft.price.trim())
    ) {
      setNotice(
        "Add the required title, content, and service price before saving.",
      );
      return;
    }
    const source: KnowledgeSource = {
      id: `source-${crypto.randomUUID()}`,
      kind: draft.kind,
      language: draft.language,
      status: "draft",
      origin: "manual",
      title,
      content,
      ...(draft.kind === "service" ? { price: draft.price.trim() } : {}),
      updatedAt: new Date().toISOString(),
    };
    updateStore(
      { ...store, sources: [source, ...store.sources] },
      "Source saved as a draft. Review it before approving retrieval.",
    );
    setDraft(emptyDraft);
    setShowComposer(false);
  }

  function setSourceStatus(source: KnowledgeSource, status: KnowledgeStatus) {
    if (
      source.status === "approved" &&
      status !== "approved" &&
      (source.kind === "hours" || source.kind === "service") &&
      store.sources.filter(
        (item) => item.kind === source.kind && item.status === "approved",
      ).length === 1
    ) {
      setNotice(
        `Approve another ${kindLabels[source.kind].toLowerCase()} source first.`,
      );
      return;
    }
    if (
      source.kind === "document" &&
      status === "approved" &&
      source.content.startsWith("Preview unavailable")
    ) {
      setNotice(
        "This file needs server-side text extraction before it can be approved.",
      );
      return;
    }
    updateStore(
      {
        ...store,
        sources: store.sources.map((item) =>
          item.id === source.id
            ? { ...item, status, updatedAt: new Date().toISOString() }
            : item,
        ),
      },
      status === "approved"
        ? "Source approved and available to practice retrieval."
        : status === "outdated"
          ? "Source marked outdated and removed from retrieval."
          : "Source returned to draft and removed from retrieval.",
    );
  }

  async function addDocument(file: File | undefined) {
    if (!file) return;
    if (file.size > 2_000_000) {
      setNotice("Choose a file smaller than 2 MB for this browser preview.");
      return;
    }
    const textFile =
      file.type.startsWith("text/") || /\.(md|txt|csv)$/i.test(file.name);
    const content = textFile
      ? (await file.text()).slice(0, 12_000).trim()
      : "Preview unavailable until the secure server-side document parser is connected.";
    const source: KnowledgeSource = {
      id: `source-${crypto.randomUUID()}`,
      kind: "document",
      language: "en",
      status: "draft",
      origin: "upload",
      title: file.name.replace(/\.[^.]+$/, ""),
      content: content || "The selected text file is empty.",
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      updatedAt: new Date().toISOString(),
    };
    updateStore(
      { ...store, sources: [source, ...store.sources] },
      textFile
        ? "Text preview added as a draft. Review it before approval."
        : "File metadata added. PDF and Word extraction will run server-side later.",
    );
  }

  function saveProfile(): boolean {
    if (!profileDraft.name.trim() || !profileDraft.description.trim()) {
      setNotice("Business name and description are required.");
      return false;
    }
    const bookingLink = bookingLinkSchema.safeParse(profileDraft.bookingUrl);
    if (!bookingLink.success) {
      setNotice(
        bookingLink.error.issues[0]?.message ?? "Check the booking link.",
      );
      return false;
    }
    updateStore(
      {
        ...store,
        profile: {
          name: profileDraft.name.trim(),
          description: profileDraft.description.trim(),
          bookingUrl: bookingLink.data,
        },
      },
      "Business profile updated.",
    );
    return true;
  }

  return (
    <section className="assistant-setup" aria-label="Assistant setup">
      <div className="assistant-setup-intro">
        <div>
          <span className="eyebrow">THREE PARTS, ONE TRUSTED ASSISTANT</span>
          <h2>Define it from the inside out.</h2>
          <p>
            Identity defines who speaks. Business profile defines who it
            represents. Knowledge defines which facts it may use.
          </p>
        </div>
        <span className="badge neutral">Practice configuration</span>
      </div>

      <nav className="assistant-setup-steps" aria-label="Assistant setup steps">
        <button
          type="button"
          className={activeStep === "identity" ? "active" : ""}
          aria-current={activeStep === "identity" ? "step" : undefined}
          onClick={() => setActiveStep("identity")}
        >
          <span>01</span>
          <div>
            <strong>Identity</strong>
            <small>Who the assistant is</small>
          </div>
          <em>{identity.name}</em>
        </button>
        <button
          type="button"
          className={activeStep === "business" ? "active" : ""}
          aria-current={activeStep === "business" ? "step" : undefined}
          onClick={() => setActiveStep("business")}
        >
          <span>02</span>
          <div>
            <strong>Business profile</strong>
            <small>Who it represents</small>
          </div>
          <em>{store.profile.name}</em>
        </button>
        <button
          type="button"
          className={activeStep === "knowledge" ? "active" : ""}
          aria-current={activeStep === "knowledge" ? "step" : undefined}
          onClick={() => setActiveStep("knowledge")}
        >
          <span>03</span>
          <div>
            <strong>Knowledge</strong>
            <small>What it may use</small>
          </div>
          <em>{counts.approved} approved</em>
        </button>
      </nav>

      {activeStep === "identity" && (
        <section
          className="assistant-foundation-panel"
          aria-labelledby="identity-title"
        >
          <div className="assistant-foundation-heading">
            <span className="assistant-foundation-icon">
              <Bot size={22} aria-hidden="true" />
            </span>
            <div>
              <span className="eyebrow">STEP 1 · WHO SPEAKS</span>
              <h2 id="identity-title">Assistant identity</h2>
              <p>
                Choose a starter purpose, then make its role, introduction, and
                safe fallback your own.
              </p>
            </div>
          </div>
          <div className="assistant-identity-layout">
            <div className="assistant-foundation-form">
              <fieldset className="assistant-purpose-picker">
                <legend>What should this assistant mainly help with?</legend>
                <p>
                  Pick a starter to load useful placeholder copy and recommended
                  features. Everything remains editable.
                </p>
                <div>
                  {assistantPurposePresets.map((preset, index) => (
                    <button
                      type="button"
                      key={preset.purpose}
                      className={
                        identityDraft.purpose === preset.purpose ? "active" : ""
                      }
                      aria-pressed={identityDraft.purpose === preset.purpose}
                      onClick={() => {
                        setIdentityDraft(identityForPurpose(preset.purpose));
                        setNotice(
                          `${preset.label} starter applied. Review and edit the defaults before saving.`,
                        );
                      }}
                    >
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <strong>{preset.label}</strong>
                      <small>{preset.summary}</small>
                      <em>Starter includes</em>
                      <ul>
                        {preset.features.map((feature) => (
                          <li key={feature}>
                            <Check size={11} aria-hidden="true" /> {feature}
                          </li>
                        ))}
                      </ul>
                    </button>
                  ))}
                </div>
                <small>
                  These are safe starting behaviors, not live integrations.
                  Configure actions and permissions later in Workflows.
                </small>
              </fieldset>
              <label>
                Assistant name
                <input
                  name="assistant-name"
                  autoComplete="off"
                  placeholder="For example: Front desk guide"
                  value={identityDraft.name}
                  maxLength={60}
                  onChange={(event) =>
                    setIdentityDraft({
                      ...identityDraft,
                      name: event.target.value,
                    })
                  }
                />
                <small>Visitors see this name in the chat header.</small>
              </label>
              <label>
                Primary role
                <textarea
                  name="assistant-role"
                  autoComplete="off"
                  placeholder="Describe the assistant’s main job in one sentence."
                  value={identityDraft.role}
                  maxLength={180}
                  onChange={(event) =>
                    setIdentityDraft({
                      ...identityDraft,
                      role: event.target.value,
                    })
                  }
                />
                <small>
                  One sentence describing the help it should provide.
                </small>
              </label>
              <label>
                Welcome greeting
                <textarea
                  name="assistant-greeting"
                  autoComplete="off"
                  placeholder="Write the first message a visitor will see."
                  value={identityDraft.greeting}
                  maxLength={240}
                  onChange={(event) =>
                    setIdentityDraft({
                      ...identityDraft,
                      greeting: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                Voice
                <select
                  name="assistant-tone"
                  value={identityDraft.tone}
                  onChange={(event) =>
                    setIdentityDraft({
                      ...identityDraft,
                      tone: event.target.value as AssistantIdentity["tone"],
                    })
                  }
                >
                  {assistantTones.map((tone) => (
                    <option key={tone} value={tone}>
                      {tone}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                When it does not know
                <textarea
                  name="assistant-fallback"
                  autoComplete="off"
                  placeholder="Explain what happens when no approved answer exists."
                  value={identityDraft.fallback}
                  maxLength={280}
                  onChange={(event) =>
                    setIdentityDraft({
                      ...identityDraft,
                      fallback: event.target.value,
                    })
                  }
                />
                <small>It should never invent an answer to fill a gap.</small>
              </label>
              <div className="assistant-foundation-actions">
                <button
                  type="button"
                  className="button dark compact"
                  onClick={() => {
                    if (saveIdentity()) setActiveStep("business");
                  }}
                >
                  Save & continue to Business profile
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
            <aside
              className="assistant-identity-preview"
              aria-label="Assistant identity preview"
            >
              <span className="eyebrow">VISITOR PREVIEW</span>
              <div className="identity-preview-head">
                <span>
                  <Bot size={19} aria-hidden="true" />
                </span>
                <div>
                  <strong>{identityDraft.name || "Assistant name"}</strong>
                  <small>
                    {profileDraft.name} · {selectedPurpose.label}
                  </small>
                </div>
              </div>
              <p className="identity-preview-greeting">
                {identityDraft.greeting || "Add a welcome greeting."}
              </p>
              <div className="identity-preview-features">
                <strong>Starter features</strong>
                <ul>
                  {selectedPurpose.features.map((feature) => (
                    <li key={feature}>
                      <Check size={12} aria-hidden="true" /> {feature}
                    </li>
                  ))}
                </ul>
              </div>
              <dl>
                <div>
                  <dt>Role</dt>
                  <dd>{identityDraft.role || "Add the assistant’s role."}</dd>
                </div>
                <div>
                  <dt>Voice</dt>
                  <dd>{identityDraft.tone}</dd>
                </div>
                <div>
                  <dt>Unknown answer</dt>
                  <dd>{identityDraft.fallback || "Add a safe fallback."}</dd>
                </div>
              </dl>
              <p className="identity-preview-note">
                Preview only · No live visitor chat
              </p>
            </aside>
          </div>
        </section>
      )}

      {activeStep === "business" && (
        <section
          className="assistant-foundation-panel"
          aria-labelledby="business-profile-title"
        >
          <div className="assistant-foundation-heading">
            <span className="assistant-foundation-icon business">
              <Building2 size={22} aria-hidden="true" />
            </span>
            <div>
              <span className="eyebrow">STEP 2 · WHO IT REPRESENTS</span>
              <h2 id="business-profile-title">Business profile</h2>
              <p>
                Set the public business identity and the destination visitors
                should use when they are ready to book.
              </p>
            </div>
          </div>
          <div className="assistant-business-layout">
            <div className="assistant-foundation-form">
              <label>
                Business name
                <input
                  name="business-name"
                  autoComplete="organization"
                  value={profileDraft.name}
                  maxLength={80}
                  onChange={(event) =>
                    setProfileDraft({
                      ...profileDraft,
                      name: event.target.value,
                    })
                  }
                />
                <small>The public name customers already recognize.</small>
              </label>
              <label>
                Business description
                <textarea
                  name="business-description"
                  autoComplete="off"
                  value={profileDraft.description}
                  maxLength={400}
                  onChange={(event) =>
                    setProfileDraft({
                      ...profileDraft,
                      description: event.target.value,
                    })
                  }
                />
                <small>
                  Explain what the business does without marketing claims.
                </small>
              </label>
              <label>
                Booking link
                <input
                  type="url"
                  name="booking-url"
                  inputMode="url"
                  autoComplete="url"
                  spellCheck={false}
                  value={profileDraft.bookingUrl}
                  maxLength={500}
                  placeholder="https://example.com/book…"
                  onChange={(event) =>
                    setProfileDraft({
                      ...profileDraft,
                      bookingUrl: event.target.value,
                    })
                  }
                />
                <small>Optional. Visitors finish booking on this page.</small>
              </label>
              <div className="assistant-foundation-actions">
                <button
                  type="button"
                  className="button outline compact"
                  onClick={() => setActiveStep("identity")}
                >
                  Back to Identity
                </button>
                <button
                  type="button"
                  className="button dark compact"
                  onClick={() => {
                    if (saveProfile()) setActiveStep("knowledge");
                  }}
                >
                  Save & continue to Knowledge
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
            <aside
              className="business-profile-summary"
              aria-label="Business profile summary"
            >
              <span className="eyebrow">PROFILE SUMMARY</span>
              <h3>{profileDraft.name || "Business name"}</h3>
              <p>{profileDraft.description || "Add a business description."}</p>
              <dl>
                <div>
                  <dt>Opening hours</dt>
                  <dd>
                    {store.sources.find(
                      (source) =>
                        source.kind === "hours" && source.status === "approved",
                    )?.content ?? "No approved hours"}
                  </dd>
                </div>
                <div>
                  <dt>Services</dt>
                  <dd>
                    {
                      store.sources.filter(
                        (source) =>
                          source.kind === "service" &&
                          source.status === "approved",
                      ).length
                    }{" "}
                    approved
                  </dd>
                </div>
                <div>
                  <dt>FAQs</dt>
                  <dd>
                    {
                      store.sources.filter(
                        (source) =>
                          source.kind === "faq" && source.status === "approved",
                      ).length
                    }{" "}
                    approved
                  </dd>
                </div>
              </dl>
              <div className="business-knowledge-note">
                <BookOpen size={17} aria-hidden="true" />
                <p>
                  Hours, services, FAQs, and policies are operational facts.
                  Review them in Knowledge next.
                </p>
              </div>
            </aside>
          </div>
        </section>
      )}

      {activeStep === "knowledge" && (
        <div className="knowledge-manager">
          <div className="knowledge-hero">
            <div>
              <span className="eyebrow">APPROVED FACTS, CLEAR SOURCES</span>
              <h2>Business knowledge</h2>
              <p>
                Organize what the assistant may use. Draft and outdated
                information is never returned by the practice retrieval test.
              </p>
            </div>
            <div className="knowledge-hero-actions">
              <label className="upload-button">
                <Upload size={15} /> Upload document
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.txt,.md,.csv,text/plain,text/markdown,application/pdf"
                  disabled={disabled}
                  onChange={(event) => {
                    void addDocument(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </label>
              <button
                className="button dark compact"
                disabled={disabled}
                onClick={() => setShowComposer((open) => !open)}
              >
                <Plus size={15} /> Add knowledge
              </button>
            </div>
          </div>

          <div className="knowledge-stats">
            <article>
              <BadgeCheck size={18} />
              <div>
                <strong>{counts.approved}</strong>
                <span>Approved</span>
              </div>
            </article>
            <article>
              <Clock3 size={18} />
              <div>
                <strong>{counts.draft}</strong>
                <span>Needs review</span>
              </div>
            </article>
            <article>
              <CircleAlert size={18} />
              <div>
                <strong>{counts.outdated}</strong>
                <span>Outdated</span>
              </div>
            </article>
            <article className="language-coverage-card">
              <Languages size={18} />
              <div>
                <strong>
                  {Object.values(coverage).filter((count) => count > 0).length}
                  /3
                </strong>
                <span>Languages covered</span>
              </div>
              <small>
                EN {coverage.en} · FA {coverage.fa} · ZH {coverage.zh}
              </small>
            </article>
          </div>

          {showComposer && (
            <div className="knowledge-composer">
              <div className="composer-heading">
                <div>
                  <Sparkles size={17} />
                  <strong>Add a trusted source</strong>
                </div>
                <span>Starts as draft</span>
              </div>
              <div className="composer-grid">
                <label>
                  Type
                  <select
                    value={draft.kind}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        kind: event.target.value as KnowledgeKind,
                      })
                    }
                  >
                    {knowledgeKinds
                      .filter((kind) => kind !== "document")
                      .map((kind) => (
                        <option value={kind} key={kind}>
                          {kindLabels[kind]}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Language
                  <select
                    value={draft.language}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        language: event.target.value as KnowledgeLanguage,
                      })
                    }
                  >
                    {Object.entries(languageLabels).map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="composer-wide">
                  {draft.kind === "faq"
                    ? "Customer question"
                    : `${kindLabels[draft.kind]} title`}
                  <input
                    value={draft.title}
                    maxLength={180}
                    onChange={(event) =>
                      setDraft({ ...draft, title: event.target.value })
                    }
                  />
                </label>
                {draft.kind === "service" && (
                  <label>
                    Listed price
                    <input
                      value={draft.price}
                      maxLength={100}
                      placeholder="$40 CAD"
                      onChange={(event) =>
                        setDraft({ ...draft, price: event.target.value })
                      }
                    />
                  </label>
                )}
                <label className="composer-wide">
                  {draft.kind === "faq" ? "Approved answer" : "Information"}
                  <textarea
                    value={draft.content}
                    maxLength={12_000}
                    onChange={(event) =>
                      setDraft({ ...draft, content: event.target.value })
                    }
                  />
                </label>
              </div>
              <div className="composer-actions">
                <button className="button dark compact" onClick={addSource}>
                  Save draft
                </button>
                <button
                  className="button outline compact"
                  onClick={() => setShowComposer(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="knowledge-grid">
            <div className="knowledge-library-panel">
              <div className="knowledge-filter-bar">
                {(["all", ...knowledgeKinds] as const).map((kind) => (
                  <button
                    key={kind}
                    className={filter === kind ? "active" : ""}
                    onClick={() => setFilter(kind)}
                  >
                    {kind === "all" ? "All sources" : kindLabels[kind]}
                  </button>
                ))}
              </div>
              <div className="knowledge-source-list">
                {visibleSources.map((source) => (
                  <article className="knowledge-source-card" key={source.id}>
                    <span className={`knowledge-kind-icon ${source.kind}`}>
                      {source.kind === "document" ? (
                        <FileText size={17} />
                      ) : source.kind === "hours" ? (
                        <Clock3 size={17} />
                      ) : (
                        <BookOpen size={17} />
                      )}
                    </span>
                    <div className="knowledge-source-copy">
                      <div className="source-badges">
                        <span className={`source-status ${source.status}`}>
                          {source.status}
                        </span>
                        <span>{languageLabels[source.language]}</span>
                        <span>{source.origin}</span>
                      </div>
                      <h3>{source.title}</h3>
                      <p>{source.content}</p>
                      {source.price && (
                        <strong className="source-price">{source.price}</strong>
                      )}
                      {source.fileName && (
                        <small>
                          {source.fileName} ·{" "}
                          {Math.max(
                            1,
                            Math.round((source.sizeBytes ?? 0) / 1024),
                          )}{" "}
                          KB
                        </small>
                      )}
                    </div>
                    <div className="source-actions">
                      {source.status !== "approved" && (
                        <button
                          onClick={() => setSourceStatus(source, "approved")}
                        >
                          <Check size={13} /> Approve
                        </button>
                      )}
                      {source.status !== "draft" && (
                        <button
                          onClick={() => setSourceStatus(source, "draft")}
                        >
                          Draft
                        </button>
                      )}
                      {source.status !== "outdated" && (
                        <button
                          onClick={() => setSourceStatus(source, "outdated")}
                        >
                          Outdated
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <aside className="knowledge-test-console">
              <div className="test-console-heading">
                <span>
                  <FlaskConical size={18} />
                </span>
                <div>
                  <small>SAFE RETRIEVAL TEST</small>
                  <strong>Ask the library</strong>
                </div>
              </div>
              <p>Tests approved sources only. No AI call or embedding cost.</p>
              <label>
                Test language
                <select
                  value={queryLanguage}
                  onChange={(event) =>
                    setQueryLanguage(event.target.value as KnowledgeLanguage)
                  }
                >
                  {Object.entries(languageLabels).map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Customer question
                <textarea
                  value={query}
                  maxLength={500}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <button
                className="button dark compact"
                onClick={() => setHasTested(true)}
              >
                <Search size={15} /> Test retrieval
              </button>
              {hasTested && (
                <div className="retrieval-results" aria-live="polite">
                  <div className="retrieval-summary">
                    <ShieldCheck size={15} />
                    <span>
                      {matches.length} approved match
                      {matches.length === 1 ? "" : "es"}
                    </span>
                  </div>
                  {matches.length > 0 ? (
                    matches.map((match) => (
                      <article key={match.source.id}>
                        <small>
                          {match.reason} · {Math.round(match.score * 100)}%
                        </small>
                        <strong>{match.source.title}</strong>
                        <p>{match.source.content}</p>
                      </article>
                    ))
                  ) : (
                    <div className="retrieval-empty">
                      <CircleAlert size={17} />
                      <p>
                        No approved source matched. The safe result is a human
                        handoff—not an invented answer.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </aside>
          </div>
        </div>
      )}
      {notice && (
        <p className="knowledge-notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
