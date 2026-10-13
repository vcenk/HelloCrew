"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  BookOpen,
  Check,
  CircleAlert,
  Clock3,
  FileText,
  FlaskConical,
  Globe2,
  Languages,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react";

import { bookingLinkSchema, type BusinessProfile } from "@/lib/business";
import {
  businessFromKnowledge,
  countLanguageCoverage,
  createKnowledgeStoreFromBusiness,
  knowledgeKinds,
  parseKnowledgeStore,
  searchApprovedKnowledge,
  type KnowledgeKind,
  type KnowledgeLanguage,
  type KnowledgeSource,
  type KnowledgeStatus,
  type KnowledgeStore,
} from "@/lib/knowledge";

const STORAGE_KEY = "hellocrew:knowledge:v1";
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

function readStore(business: BusinessProfile): KnowledgeStore {
  if (typeof window === "undefined")
    return createKnowledgeStoreFromBusiness(business);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createKnowledgeStoreFromBusiness(business);
    const parsed = parseKnowledgeStore(JSON.parse(raw));
    return parsed.success
      ? parsed.data
      : createKnowledgeStoreFromBusiness(business);
  } catch {
    return createKnowledgeStoreFromBusiness(business);
  }
}

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

export function KnowledgeManager({
  business,
  disabled,
  onSave,
}: {
  business: BusinessProfile;
  disabled: boolean;
  onSave: (business: BusinessProfile) => void;
}) {
  const [store, setStore] = useState(() => readStore(business));
  const [filter, setFilter] = useState<"all" | KnowledgeKind>("all");
  const [showComposer, setShowComposer] = useState(false);
  const [draft, setDraft] = useState<SourceDraft>(emptyDraft);
  const [profileDraft, setProfileDraft] = useState(store.profile);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("Is parking available?");
  const [queryLanguage, setQueryLanguage] = useState<KnowledgeLanguage>("en");
  const [hasTested, setHasTested] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
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

  function updateStore(next: KnowledgeStore, message?: string) {
    setStore(next);
    setNotice(message ?? "");
    setHasTested(false);
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

  function saveProfile() {
    if (!profileDraft.name.trim() || !profileDraft.description.trim()) {
      setNotice("Business name and description are required.");
      return;
    }
    const bookingLink = bookingLinkSchema.safeParse(profileDraft.bookingUrl);
    if (!bookingLink.success) {
      setNotice(
        bookingLink.error.issues[0]?.message ?? "Check the booking link.",
      );
      return;
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
  }

  return (
    <section
      className="knowledge-manager"
      aria-label="Business knowledge manager"
    >
      <div className="knowledge-hero">
        <div>
          <span className="eyebrow">APPROVED FACTS, CLEAR SOURCES</span>
          <h2>Business knowledge</h2>
          <p>
            Organize what the assistant may use. Draft and outdated information
            is never returned by the practice retrieval test.
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
              {Object.values(coverage).filter((count) => count > 0).length}/3
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
                      {Math.max(1, Math.round((source.sizeBytes ?? 0) / 1024))}{" "}
                      KB
                    </small>
                  )}
                </div>
                <div className="source-actions">
                  {source.status !== "approved" && (
                    <button onClick={() => setSourceStatus(source, "approved")}>
                      <Check size={13} /> Approve
                    </button>
                  )}
                  {source.status !== "draft" && (
                    <button onClick={() => setSourceStatus(source, "draft")}>
                      Draft
                    </button>
                  )}
                  {source.status !== "outdated" && (
                    <button onClick={() => setSourceStatus(source, "outdated")}>
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

      <details className="knowledge-profile-settings">
        <summary>
          <Globe2 size={16} /> Business profile and booking link
        </summary>
        <div>
          <label>
            Business name
            <input
              value={profileDraft.name}
              maxLength={80}
              onChange={(event) =>
                setProfileDraft({ ...profileDraft, name: event.target.value })
              }
            />
          </label>
          <label>
            Booking link
            <input
              value={profileDraft.bookingUrl}
              maxLength={500}
              onChange={(event) =>
                setProfileDraft({
                  ...profileDraft,
                  bookingUrl: event.target.value,
                })
              }
            />
          </label>
          <label className="profile-description">
            Business description
            <textarea
              value={profileDraft.description}
              maxLength={400}
              onChange={(event) =>
                setProfileDraft({
                  ...profileDraft,
                  description: event.target.value,
                })
              }
            />
          </label>
          <button className="button dark compact" onClick={saveProfile}>
            Save business profile
          </button>
        </div>
      </details>
      {notice && (
        <p className="knowledge-notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
