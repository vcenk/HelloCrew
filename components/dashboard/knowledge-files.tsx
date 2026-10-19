"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Download,
  FileSpreadsheet,
  FileText,
  LoaderCircle,
  PencilLine,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import {
  deleteKnowledgeFile,
  getKnowledgeFile,
  listKnowledgeFiles,
  processKnowledgeFile,
  startKnowledgeUpload,
  updateKnowledgeFile,
  type KnowledgeFile,
} from "@/app/app/knowledge-file-actions";
import {
  MAX_KNOWLEDGE_ITEMS,
  parseKnowledgeStore,
  type KnowledgeSource,
  type KnowledgeStore,
} from "@/lib/knowledge";
import { createClient } from "@/lib/supabase/client";
import { useDashboard } from "./provider";
import { Button, Panel, Pill } from "./ui";

export const ACCEPT = ".pdf,.docx,.xlsx,.csv,.txt,.md";
const MAX_BYTES = 10 * 1024 * 1024;

const statusLabel: Record<KnowledgeFile["status"], string> = {
  uploading: "Uploading",
  reading: "Reading",
  review: "Needs review",
  ready: "Live",
  error: "Problem",
};
const statusTone: Record<KnowledgeFile["status"], "neutral" | "success" | "attention" | "info"> = {
  uploading: "info",
  reading: "info",
  review: "attention",
  ready: "success",
  error: "neutral",
};

function sizeLabel(bytes: number | null) {
  if (!bytes) return "";
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const limits = { service: 80, faq: 160 } as Record<string, number>;

// Turns AI suggestions into draft knowledge items linked to their file.
function draftsFrom(
  file: KnowledgeFile,
  suggestions: { kind: KnowledgeSource["kind"]; title: string; content: string; price?: string }[],
): KnowledgeSource[] {
  const now = new Date().toISOString();
  return suggestions.map((s) => ({
    id: `source-${crypto.randomUUID()}`,
    kind: s.kind,
    language: "en",
    status: "draft",
    origin: "upload",
    title: s.title.slice(0, limits[s.kind] ?? 180),
    content: s.content.slice(0, 12000),
    ...(s.kind === "service" && s.price ? { price: s.price.slice(0, 80) } : {}),
    fileName: file.fileName?.slice(0, 240) ?? undefined,
    fileId: file.id,
    updatedAt: now,
  }));
}

export function useKnowledgeFiles() {
  const { account, knowledge, saveKnowledge, toast } = useDashboard();
  const signedIn = account.status === "signed_in";
  const [files, setFiles] = useState<KnowledgeFile[]>([]);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const knowledgeRef = useRef(knowledge);
  useEffect(() => {
    knowledgeRef.current = knowledge;
  }, [knowledge]);

  const refresh = useCallback(async () => {
    if (!signedIn) return;
    const result = await listKnowledgeFiles().catch(() => null);
    if (result?.ok) setFiles(result.files);
  }, [signedIn]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const patchFile = useCallback((file: KnowledgeFile) => {
    setFiles((list) => [file, ...list.filter((f) => f.id !== file.id)]);
  }, []);

  const upload = useCallback(
    async (file: File) => {
      if (file.size > MAX_BYTES) {
        toast("Files can be up to 10 MB.", "error");
        return;
      }
      const start = await startKnowledgeUpload({ fileName: file.name, sizeBytes: file.size }).catch(() => null);
      if (!start?.ok) {
        toast(start?.error ?? "Couldn’t start the upload.", "error");
        return;
      }
      const placeholder: KnowledgeFile = {
        id: start.fileId,
        kind: "file",
        title: file.name.replace(/\.[^.]+$/, ""),
        fileName: file.name,
        mimeType: start.mimeType,
        sizeBytes: file.size,
        status: "uploading",
        error: null,
        pageCount: null,
        useForAnswers: false,
        suggestedCount: 0,
        createdAt: new Date().toISOString(),
      };
      patchFile(placeholder);
      const { error } = await createClient()
        .storage.from("knowledge")
        .uploadToSignedUrl(start.path, start.token, file, { contentType: start.mimeType });
      if (error) {
        patchFile({ ...placeholder, status: "error", error: "The upload didn’t finish." });
        toast("The upload didn’t finish. Try again.", "error");
        return;
      }
      patchFile({ ...placeholder, status: "reading" });
      const result = await processKnowledgeFile(start.fileId).catch(() => null);
      if (!result?.ok) {
        patchFile({ ...placeholder, status: "error", error: result?.error ?? "This file couldn’t be read." });
        toast(result?.error ?? "This file couldn’t be read.", "error");
        return;
      }
      patchFile(result.file);
      if (result.note) setNotes((n) => ({ ...n, [result.file.id]: result.note! }));
      // Suggestions join Knowledge as drafts: nothing is live until approved.
      const current = knowledgeRef.current;
      const room = MAX_KNOWLEDGE_ITEMS - current.sources.length;
      const drafts = draftsFrom(result.file, result.suggestions).slice(0, Math.max(0, room));
      if (drafts.length) {
        const next = parseKnowledgeStore({ ...current, sources: [...current.sources, ...drafts] });
        if (next.success) saveKnowledge(next.data as KnowledgeStore);
      }
      if (drafts.length < result.suggestions.length)
        toast(`Knowledge is full (${MAX_KNOWLEDGE_ITEMS} items), so some suggestions were skipped.`, "info");
      toast(
        drafts.length ? `Found ${drafts.length} item${drafts.length === 1 ? "" : "s"} in ${file.name}. Review them.` : `Read ${file.name}.`,
        "info",
      );
      setReviewing(result.file.id);
    },
    [patchFile, saveKnowledge, toast],
  );

  const remove = useCallback(
    async (file: KnowledgeFile) => {
      const result = await deleteKnowledgeFile(file.id).catch(() => null);
      if (!result?.ok) {
        toast(result?.error ?? "Couldn’t delete the file.", "error");
        return;
      }
      setFiles((list) => list.filter((f) => f.id !== file.id));
      const current = knowledgeRef.current;
      const kept = current.sources.filter((s) => s.fileId !== file.id);
      if (kept.length !== current.sources.length) saveKnowledge({ ...current, sources: kept });
      setReviewing(null);
      toast("File and its items removed", "info");
    },
    [saveKnowledge, toast],
  );

  return { signedIn, files, refresh, upload, remove, patchFile, reviewing, setReviewing, notes };
}

export function FilesPanel({
  state,
  onAdd,
}: {
  state: ReturnType<typeof useKnowledgeFiles>;
  onAdd: () => void;
}) {
  const { knowledge } = useDashboard();
  if (!state.signedIn)
    return (
      <Panel title="Files & links">
        <p className="today-note">Sign in to add price lists, menus and other documents.</p>
      </Panel>
    );
  return (
    <Panel
      title="Files & links"
      className="files-panel"
      actions={
        <Button size="sm" variant="ghost" icon={Upload} onClick={onAdd}>
          Add a file
        </Button>
      }
    >
      {state.files.length === 0 ? (
        <button type="button" className="file-drop-hint" onClick={onAdd}>
          <Upload size={18} aria-hidden="true" />
          <span>
            <strong>Upload a price list, menu or FAQ</strong>
            <small>PDF, Word, Excel, CSV or text, up to 10 MB. We suggest items; you approve them.</small>
          </span>
        </button>
      ) : (
        <ul className="file-cards">
          {state.files.map((file) => {
            const items = knowledge.sources.filter((s) => s.fileId === file.id);
            const drafts = items.filter((s) => s.status !== "approved").length;
            const busy = file.status === "uploading" || file.status === "reading";
            const Icon = file.mimeType?.includes("sheet") || file.mimeType === "text/csv" ? FileSpreadsheet : FileText;
            return (
              <li key={file.id}>
                <button
                  type="button"
                  className="file-card"
                  data-status={file.status}
                  disabled={busy}
                  onClick={() => state.setReviewing(file.id)}
                >
                  <span className="file-card-icon" aria-hidden="true">
                    {busy ? <LoaderCircle size={17} className="spin" /> : <Icon size={17} />}
                  </span>
                  <span className="file-card-text">
                    <strong>{file.title}</strong>
                    <small>
                      {file.status === "error"
                        ? file.error
                        : busy
                          ? file.status === "uploading"
                            ? "Uploading…"
                            : "Reading and suggesting items…"
                          : [
                              `${items.length} item${items.length === 1 ? "" : "s"}`,
                              drafts ? `${drafts} to review` : null,
                              file.useForAnswers ? "full text searchable" : null,
                              sizeLabel(file.sizeBytes),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                    </small>
                  </span>
                  <Pill tone={statusTone[file.status]}>{statusLabel[file.status]}</Pill>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function FileReviewDialog({
  state,
  onEditItem,
}: {
  state: ReturnType<typeof useKnowledgeFiles>;
  onEditItem: (source: KnowledgeSource) => void;
}) {
  const { knowledge, saveKnowledge, toast } = useDashboard();
  const dialog = useRef<HTMLDialogElement>(null);
  const file = state.files.find((f) => f.id === state.reviewing) ?? null;
  const [text, setText] = useState<string | null>(null);
  const [savedText, setSavedText] = useState("");
  const [download, setDownload] = useState<string | null>(null);
  const [useForAnswers, setUseForAnswers] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showText, setShowText] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!file) {
      dialog.current?.close();
      return;
    }
    if (!dialog.current?.open) dialog.current?.showModal();
    let cancelled = false;
    void getKnowledgeFile(file.id).then((result) => {
      if (cancelled || !result.ok) return;
      setText(result.text);
      setSavedText(result.text);
      setDownload(result.downloadUrl);
      setUseForAnswers(result.file.status === "ready" ? result.file.useForAnswers : true);
      setConfirmDelete(false);
      setShowText(false);
    });
    return () => {
      cancelled = true;
    };
    // Only when a different file opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id]);

  if (!file)
    return <dialog ref={dialog} className="ui-dialog file-dialog" onClose={() => state.setReviewing(null)} />;

  const items = knowledge.sources.filter((s) => s.fileId === file.id);
  const drafts = items.filter((s) => s.status !== "approved");

  function setStatus(ids: string[], status: "approved" | "draft") {
    saveKnowledge({
      ...knowledge,
      sources: knowledge.sources.map((s) => (ids.includes(s.id) ? { ...s, status, updatedAt: new Date().toISOString() } : s)),
    });
  }
  function discard(id: string) {
    saveKnowledge({ ...knowledge, sources: knowledge.sources.filter((s) => s.id !== id) });
  }

  async function finish() {
    setBusy(true);
    const result = await updateKnowledgeFile({ fileId: file!.id, useForAnswers, done: true }).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      toast(result?.error ?? "Couldn’t save.", "error");
      return;
    }
    state.patchFile(result.file);
    toast(useForAnswers ? `${file!.title} is live` : "Review saved");
    state.setReviewing(null);
  }

  async function saveText() {
    if (text === null) return;
    setBusy(true);
    const result = await updateKnowledgeFile({ fileId: file!.id, text }).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      toast(result?.error ?? "Couldn’t save the text.", "error");
      return;
    }
    setSavedText(text);
    state.patchFile(result.file);
    toast("Text saved");
  }

  return (
    <dialog
      ref={dialog}
      className="ui-dialog file-dialog"
      aria-labelledby="file-dialog-title"
      onClose={() => state.setReviewing(null)}
    >
      <header className="file-dialog-head">
        <span className="file-card-icon" aria-hidden="true">
          <FileText size={18} />
        </span>
        <div>
          <h2 id="file-dialog-title">{file.title}</h2>
          <small>
            {[file.fileName, file.pageCount ? `${file.pageCount} page${file.pageCount === 1 ? "" : "s"}` : null, sizeLabel(file.sizeBytes)]
              .filter(Boolean)
              .join(" · ")}
          </small>
        </div>
        <button type="button" className="dash-icon-button" aria-label="Close" onClick={() => dialog.current?.close()}>
          <X size={16} />
        </button>
      </header>

      {state.notes[file.id] && (
        <p className="file-note">
          <AlertTriangle size={15} aria-hidden="true" /> {state.notes[file.id]}
        </p>
      )}

      <section className="file-section">
        <header>
          <h3>
            <Sparkles size={15} aria-hidden="true" /> Items from this file
          </h3>
          {drafts.length > 1 && (
            <Button size="sm" variant="secondary" icon={Check} onClick={() => setStatus(drafts.map((d) => d.id), "approved")}>
              Approve all {drafts.length}
            </Button>
          )}
        </header>
        {items.length === 0 ? (
          <p className="today-note">No items yet. Your crew can still use this file if you let it search the full text below.</p>
        ) : (
          <ul className="suggestion-list">
            {items.map((item) => (
              <li key={item.id} data-status={item.status}>
                <div>
                  <small>{{ hours: "Hours", service: "Service", faq: "Q&A", policy: "Policy", document: "Info" }[item.kind]}</small>
                  <strong>
                    {item.title}
                    {item.price && <span className="kitem-price">{item.price}</span>}
                  </strong>
                  <p>{item.content}</p>
                </div>
                <div className="suggestion-actions">
                  {item.status === "approved" ? (
                    <Pill tone="success">Live</Pill>
                  ) : (
                    <Button size="sm" variant="primary" icon={Check} onClick={() => setStatus([item.id], "approved")}>
                      Approve
                    </Button>
                  )}
                  <button type="button" className="dash-icon-button" aria-label={`Edit ${item.title}`} onClick={() => onEditItem(item)}>
                    <PencilLine size={15} />
                  </button>
                  <button type="button" className="dash-icon-button" aria-label={`Discard ${item.title}`} onClick={() => discard(item.id)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="file-section">
        <label className="switch">
          <input type="checkbox" checked={useForAnswers} onChange={(e) => setUseForAnswers(e.target.checked)} />
          <span aria-hidden="true" />
          Let your crew search the full text for details not covered above
        </label>
        <button type="button" className="link-button" onClick={() => setShowText((v) => !v)}>
          {showText ? "Hide the text we read" : "See and fix the text we read"}
        </button>
        {showText && (
          <div className="field">
            <label htmlFor="file-text" className="sr-only">
              Text read from the file
            </label>
            <textarea
              id="file-text"
              rows={10}
              value={text ?? "Loading…"}
              disabled={text === null}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="form-actions">
              <Button size="sm" disabled={busy || text === null || text === savedText} onClick={() => void saveText()}>
                Save text
              </Button>
            </div>
          </div>
        )}
      </section>

      <footer className="ui-dialog-actions">
        {confirmDelete ? (
          <Button variant="danger" icon={Trash2} className="kdialog-delete" onClick={() => void state.remove(file)}>
            Delete file and its {items.length} item{items.length === 1 ? "" : "s"}
          </Button>
        ) : (
          <Button variant="ghost" icon={Trash2} className="kdialog-delete" onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        )}
        {download && (
          <a className="ui-btn ui-btn-ghost ui-btn-md" href={download} target="_blank" rel="noopener">
            <Download size={16} aria-hidden="true" /> Original
          </a>
        )}
        <Button variant="primary" icon={Check} disabled={busy} onClick={() => void finish()}>
          Done
        </Button>
      </footer>
    </dialog>
  );
}
