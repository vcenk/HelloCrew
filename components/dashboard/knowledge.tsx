"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  Clock,
  FileText,
  GraduationCap,
  HelpCircle,
  PencilLine,
  Plus,
  Scissors,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import {
  parseKnowledgeStore,
  searchApprovedKnowledge,
  type KnowledgeKind,
  type KnowledgeSource,
  type KnowledgeStore,
} from "@/lib/knowledge";
import { UNANSWERED } from "./chat-thread";
import { useDashboard } from "./provider";
import { Button, EmptyState, PageHeader, Panel, Pill } from "./ui";

const groups: { kind: KnowledgeKind; title: string; icon: typeof BookOpen; hint: string }[] = [
  { kind: "hours", title: "Opening hours", icon: Clock, hint: "When customers can come in or call." },
  { kind: "service", title: "Services & prices", icon: Scissors, hint: "What you offer and what it costs." },
  { kind: "faq", title: "Questions & answers", icon: HelpCircle, hint: "The things customers ask most." },
  { kind: "policy", title: "Policies", icon: ShieldCheck, hint: "Cancellations, deposits, refunds." },
  { kind: "document", title: "Documents", icon: FileText, hint: "Longer notes your crew can search." },
];

type Draft = { id?: string; kind: KnowledgeKind; title: string; content: string; price: string; approved: boolean };

const emptyDraft = (kind: KnowledgeKind = "faq"): Draft => ({ kind, title: "", content: "", price: "", approved: true });

export function KnowledgeView() {
  const { knowledge, saveKnowledge, conversation, toast, needsYou } = useDashboard();
  const params = useSearchParams();
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  // Opening from "Teach this answer" prefills a new Q&A with the question.
  const teach = params.get("teach");
  useEffect(() => {
    if (!teach) return;
    openEditor({ ...emptyDraft("faq"), title: teach.slice(0, 160) });
    router.replace("/app/knowledge", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teach]);

  const suggestions = useMemo(() => {
    const out: string[] = [];
    for (const u of needsYou?.unanswered ?? [])
      if (!out.includes(u.question) && !knowledge.sources.some((s) => s.title.toLowerCase() === u.question.toLowerCase()))
        out.push(u.question);
    conversation.messages.forEach((m, i) => {
      if (m.role !== "assistant" || m.source !== UNANSWERED) return;
      const q = [...conversation.messages.slice(0, i)].reverse().find((c) => c.role === "customer")?.text;
      if (q && !out.includes(q) && !knowledge.sources.some((s) => s.title.toLowerCase() === q.toLowerCase()))
        out.push(q);
    });
    return out;
  }, [conversation.messages, knowledge.sources, needsYou]);

  const matches = query.trim() ? searchApprovedKnowledge(knowledge, query) : [];
  const approvedCount = knowledge.sources.filter((s) => s.status === "approved").length;

  function commit(next: KnowledgeStore, message: string) {
    const parsed = parseKnowledgeStore(next);
    if (!parsed.success) {
      toast("That change couldn’t be saved. Check the text lengths.", "error");
      return false;
    }
    saveKnowledge(parsed.data as KnowledgeStore);
    toast(message);
    return true;
  }

  function openEditor(next: Draft) {
    setDraft(next);
    setError("");
    dialog.current?.showModal();
  }

  function editSource(source: KnowledgeSource) {
    openEditor({
      id: source.id,
      kind: source.kind,
      title: source.title,
      content: source.content,
      price: source.price ?? "",
      approved: source.status === "approved",
    });
  }

  function saveDraft() {
    const title = draft.title.trim();
    const content = draft.content.trim() || (draft.kind === "service" && draft.price ? `${title} is available for ${draft.price}.` : "");
    if (!title || !content) {
      setError(draft.kind === "faq" ? "Add the question and its answer." : "Add a title and some content.");
      return;
    }
    if (draft.kind === "service" && !draft.price.trim()) {
      setError("Add a price so your crew can quote it.");
      return;
    }
    const now = new Date().toISOString();
    const existing = knowledge.sources.find((s) => s.id === draft.id);
    const source: KnowledgeSource = {
      ...(existing ?? { id: `source-${crypto.randomUUID()}`, language: "en" as const, origin: "manual" as const }),
      kind: draft.kind,
      title,
      content,
      status: draft.approved ? "approved" : "draft",
      updatedAt: now,
      ...(draft.kind === "service" ? { price: draft.price.trim() } : {}),
    } as KnowledgeSource;
    if (draft.kind !== "service") delete source.price;
    const sources = existing
      ? knowledge.sources.map((s) => (s.id === existing.id ? source : s))
      : [...knowledge.sources, source];
    if (commit({ ...knowledge, sources }, existing ? "Knowledge updated" : "Added to knowledge")) dialog.current?.close();
  }

  // Practice replies need at least one live service with a price.
  function isLastLiveService(source: KnowledgeSource) {
    return (
      source.kind === "service" &&
      source.status === "approved" &&
      knowledge.sources.filter((s) => s.kind === "service" && s.status === "approved" && s.price).length <= 1
    );
  }

  function toggle(source: KnowledgeSource) {
    if (isLastLiveService(source)) {
      toast("Keep at least one live service so your crew can quote a price.", "info");
      return;
    }
    const status = source.status === "approved" ? "draft" : "approved";
    commit(
      {
        ...knowledge,
        sources: knowledge.sources.map((s) => (s.id === source.id ? { ...s, status, updatedAt: new Date().toISOString() } : s)),
      },
      status === "approved" ? `“${source.title}” is live` : `“${source.title}” moved to draft`,
    );
  }

  function remove(source: KnowledgeSource) {
    if (isLastLiveService(source)) {
      toast("Keep at least one live service so your crew can quote a price.", "info");
      return;
    }
    commit({ ...knowledge, sources: knowledge.sources.filter((s) => s.id !== source.id) }, "Removed from knowledge");
  }

  return (
    <div className="kpage">
      <PageHeader
        title="Knowledge"
        description="What your whole crew may say. Only live items are used, and nothing is ever guessed."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => openEditor(emptyDraft())}>
            Add knowledge
          </Button>
        }
      />

      {suggestions.length > 0 && (
        <Panel title="Suggested from conversations" className="suggestions" actions={<Pill tone="attention">{suggestions.length}</Pill>}>
          <ul>
            {suggestions.slice(0, 5).map((q) => (
              <li key={q}>
                <GraduationCap size={16} aria-hidden="true" />
                <span>“{q}”</span>
                <Button size="sm" onClick={() => openEditor({ ...emptyDraft("faq"), title: q.slice(0, 160) })}>
                  Teach this answer
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="knowledge-grid">
        <div className="knowledge-main">
          {groups.map((group) => {
            const items = knowledge.sources.filter((s) => s.kind === group.kind);
            return (
              <section className="kgroup" key={group.kind} aria-labelledby={`k-${group.kind}`}>
                <header>
                  <span className="kgroup-icon" aria-hidden="true">
                    <group.icon size={16} />
                  </span>
                  <div>
                    <h2 id={`k-${group.kind}`}>{group.title}</h2>
                    <small>{group.hint}</small>
                  </div>
                  <Button size="sm" variant="ghost" icon={Plus} onClick={() => openEditor(emptyDraft(group.kind))}>
                    Add
                  </Button>
                </header>
                {items.length === 0 ? (
                  <p className="kgroup-empty">Nothing here yet.</p>
                ) : (
                  <ul>
                    {items.map((source) => (
                      <li key={source.id} data-status={source.status}>
                        <button type="button" className="kitem" onClick={() => editSource(source)}>
                          <strong>
                            {source.title}
                            {source.price && <span className="kitem-price">{source.price}</span>}
                          </strong>
                          <span>{source.content}</span>
                        </button>
                        <label className="switch" title={source.status === "approved" ? "Live: your crew uses this" : "Draft: not used yet"}>
                          <input
                            type="checkbox"
                            checked={source.status === "approved"}
                            onChange={() => toggle(source)}
                            aria-label={`${source.title} is live`}
                          />
                          <span aria-hidden="true" />
                          {source.status === "approved" ? "Live" : "Draft"}
                        </label>
                        <button type="button" className="dash-icon-button" aria-label={`Edit ${source.title}`} onClick={() => editSource(source)}>
                          <PencilLine size={15} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>

        <aside className="knowledge-side">
          <Panel title="Check an answer">
            <label className="search-field">
              <Search size={15} aria-hidden="true" />
              <span className="sr-only">Question to check</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type a customer question"
              />
            </label>
            {query.trim() &&
              (matches.length === 0 ? (
                <p className="preview-miss">No live knowledge matches. Your crew would say it doesn’t know and offer a person.</p>
              ) : (
                <ul className="preview-hits">
                  {matches.slice(0, 3).map((m) => (
                    <li key={m.source.id}>
                      <strong>{m.source.title}</strong>
                      <small>
                        {m.reason} · {Math.round(m.score * 100)}%
                      </small>
                    </li>
                  ))}
                </ul>
              ))}
            <p className="today-note">Free check with no AI call. {approvedCount} live items.</p>
          </Panel>

          <Panel title="Business profile">
            <ProfileForm key={JSON.stringify(knowledge.profile)} onSave={(profile) => commit({ ...knowledge, profile }, "Business profile saved")} />
          </Panel>
        </aside>
      </div>

      <dialog ref={dialog} className="ui-dialog kdialog" aria-labelledby="kdialog-title">
        <form
          method="dialog"
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            saveDraft();
          }}
        >
          <h2 id="kdialog-title">{draft.id ? "Edit knowledge" : "Add knowledge"}</h2>
          <div className="field">
            <label htmlFor="d-kind">Type</label>
            <select id="d-kind" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as KnowledgeKind })}>
              {groups.map((g) => (
                <option key={g.kind} value={g.kind}>
                  {g.title}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="d-title">{draft.kind === "faq" ? "Customer question" : draft.kind === "service" ? "Service" : "Title"}</label>
            <input id="d-title" maxLength={draft.kind === "service" ? 80 : draft.kind === "faq" ? 160 : 180} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </div>
          {draft.kind === "service" && (
            <div className="field">
              <label htmlFor="d-price">Price</label>
              <input id="d-price" maxLength={80} placeholder="$40" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
            </div>
          )}
          <div className="field">
            <label htmlFor="d-content">{draft.kind === "faq" ? "Answer" : "Details"}</label>
            <textarea id="d-content" rows={4} maxLength={draft.kind === "faq" ? 500 : draft.kind === "hours" ? 200 : 2000} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
          </div>
          <label className="switch">
            <input type="checkbox" checked={draft.approved} onChange={(e) => setDraft({ ...draft, approved: e.target.checked })} />
            <span aria-hidden="true" />
            Live now (your crew may use it)
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="ui-dialog-actions">
            {draft.id && (
              <Button
                variant="danger"
                icon={Trash2}
                className="kdialog-delete"
                onClick={() => {
                  const source = knowledge.sources.find((s) => s.id === draft.id);
                  if (source) remove(source);
                  dialog.current?.close();
                }}
              >
                Delete
              </Button>
            )}
            <Button variant="ghost" onClick={() => dialog.current?.close()}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" icon={Check}>
              Save
            </Button>
          </div>
        </form>
      </dialog>

      {knowledge.sources.length === 0 && (
        <EmptyState icon={BookOpen} title="No knowledge yet">
          Start with your opening hours and the three questions customers ask most.
        </EmptyState>
      )}
    </div>
  );
}

function ProfileForm({ onSave }: { onSave: (profile: KnowledgeStore["profile"]) => void }) {
  const { knowledge } = useDashboard();
  const [profile, setProfile] = useState(knowledge.profile);
  const dirty = JSON.stringify(profile) !== JSON.stringify(knowledge.profile);
  return (
    <form
      className="form-stack"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          name: profile.name.trim(),
          description: profile.description.trim(),
          bookingUrl: profile.bookingUrl.trim(),
        });
      }}
    >
      <div className="field">
        <label htmlFor="k-name">Business name</label>
        <input id="k-name" maxLength={80} value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="k-desc">What you do</label>
        <textarea id="k-desc" rows={3} maxLength={400} value={profile.description} onChange={(e) => setProfile({ ...profile, description: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="k-url">Booking link (optional)</label>
        <input id="k-url" type="url" maxLength={500} placeholder="https://" value={profile.bookingUrl} onChange={(e) => setProfile({ ...profile, bookingUrl: e.target.value })} />
      </div>
      <Button type="submit" size="sm" variant="primary" icon={Check} disabled={!dirty}>
        Save profile
      </Button>
    </form>
  );
}
