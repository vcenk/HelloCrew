import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ActionResult, ChangeSet, UndoToken } from "@/lib/copilot/contracts";
import {
  applySelected,
  buildKnowledgeChangeSet,
  type KnowledgeChangePlan,
} from "@/lib/copilot/knowledge-changes";
import { loadDocuments, saveDocument, type WorkspaceContext } from "@/lib/data/workspace";
import {
  parseKnowledgeStore,
  searchApprovedKnowledge,
  type KnowledgeStore,
} from "@/lib/knowledge";
import type { SuggestionInput } from "@/lib/knowledge-merge";

/**
 * The Copilot's knowledge actions, executed.
 *
 * Every one of these loads the same document the Knowledge page edits and
 * writes it back with the same compare-and-swap. There is deliberately no
 * second path into knowledge: if the Copilot could write somewhere the
 * Knowledge page does not read, the two would drift and the owner would be
 * told something that is not on their screen.
 */

const KEY = "knowledge" as const;

type LoadedStore = { store: KnowledgeStore; version: number };

async function loadStore(
  db: SupabaseClient,
  workspace: WorkspaceContext,
): Promise<LoadedStore | null> {
  const documents = await loadDocuments(db, workspace);
  const stored = documents[KEY];
  if (!stored) return null;
  const parsed = parseKnowledgeStore(stored.document);
  if (!parsed.success) return null;
  return { store: parsed.data, version: stored.version };
}

/** read_only: what the business already says about something. */
export async function copilotSearchKnowledge(
  db: SupabaseClient,
  workspace: WorkspaceContext,
  query: string,
): Promise<ActionResult> {
  const loaded = await loadStore(db, workspace);
  if (!loaded)
    return {
      status: "failed",
      summary: "Your knowledge could not be read.",
      applied: 0,
      skipped: 0,
      links: [],
    };

  const matches = searchApprovedKnowledge(loaded.store, query).slice(0, 5);
  return {
    status: "applied",
    summary:
      matches.length === 0
        ? `Nothing approved mentions "${query}".`
        : `${matches.length} approved item${matches.length === 1 ? "" : "s"} mention "${query}": ${matches
            .map((match) => match.source.title)
            .join(", ")}.`,
    applied: 0,
    skipped: 0,
    links: [{ label: "Knowledge", href: "/app/knowledge" }],
  };
}

/**
 * draft_write, first half: read a document and work out what it would add.
 *
 * Nothing is written here. The plan is handed back so the owner can see it
 * and decide; the ids in it are the ids that would be created.
 */
export async function planKnowledgeFromDocument(
  db: SupabaseClient,
  workspace: WorkspaceContext,
  input: {
    proposalId: string;
    file: { id: string; kind: "file" | "url"; fileName: string | null; title: string };
    suggestions: SuggestionInput[];
    note?: string | null;
  },
): Promise<{ plan: KnowledgeChangePlan; version: number } | null> {
  const loaded = await loadStore(db, workspace);
  if (!loaded) return null;
  return {
    plan: buildKnowledgeChangeSet({
      id: input.proposalId,
      store: loaded.store,
      file: input.file,
      suggestions: input.suggestions,
      note: input.note,
    }),
    version: loaded.version,
  };
}

/**
 * draft_write, second half: write the operations the owner kept.
 *
 * Re-reads and re-plans against the store as it is now rather than trusting
 * the version the panel was looking at. Somebody may have edited knowledge in
 * another tab while the owner was reading the card.
 */
export async function applyKnowledgeFromDocument(
  db: SupabaseClient,
  workspace: WorkspaceContext,
  input: {
    proposalId: string;
    file: { id: string; kind: "file" | "url"; fileName: string | null; title: string };
    suggestions: SuggestionInput[];
    operationIds: string[];
    edits?: Record<string, { title?: string; content?: string; price?: string }>;
  },
): Promise<ActionResult> {
  const loaded = await loadStore(db, workspace);
  if (!loaded)
    return {
      status: "failed",
      summary: "Your knowledge could not be read, so nothing was added.",
      applied: 0,
      skipped: 0,
      links: [],
    };

  const plan = buildKnowledgeChangeSet({
    id: input.proposalId,
    store: loaded.store,
    file: input.file,
    suggestions: input.suggestions,
  });

  // Only ids this plan actually produced. An id from anywhere else is not a
  // thing the owner was shown, so it is not a thing we write.
  const known = input.operationIds.filter((id) => plan.byOperation.has(id));
  if (known.length === 0)
    return {
      status: "rejected",
      summary: "Nothing was selected, so nothing changed.",
      applied: 0,
      skipped: input.operationIds.length,
      links: [],
    };

  const sources = applySelected(loaded.store, plan, known, input.edits);
  const saved = await saveDocument(db, workspace, KEY, loaded.version, {
    ...loaded.store,
    sources,
  });

  if (!saved.ok)
    return {
      status: "failed",
      summary:
        saved.reason === "conflict"
          ? "Your knowledge changed in another tab while you were reading this. Nothing was added — ask again to see the latest."
          : "Those items could not be saved.",
      applied: 0,
      skipped: known.length,
      links: [],
    };

  const undo: UndoToken = {
    token: JSON.stringify({ k: KEY, ids: known }),
    action: "knowledge_add_from_document",
    expiresAt: Date.now() + 60 * 60 * 1000,
    describes: `${known.length} draft item${known.length === 1 ? "" : "s"}`,
  };

  return {
    status: known.length === input.operationIds.length ? "draft" : "partial",
    summary: `Added ${known.length} item${known.length === 1 ? "" : "s"} to Knowledge as drafts. Nothing is live until you approve it.`,
    applied: known.length,
    skipped: input.operationIds.length - known.length,
    links: [{ label: "Open Knowledge", href: "/app/knowledge" }],
    undo,
  };
}

/** live_configuration: let the crew actually use specific draft items. */
export async function approveKnowledgeSources(
  db: SupabaseClient,
  workspace: WorkspaceContext,
  sourceIds: string[],
): Promise<ActionResult> {
  const loaded = await loadStore(db, workspace);
  if (!loaded)
    return {
      status: "failed",
      summary: "Your knowledge could not be read.",
      applied: 0,
      skipped: 0,
      links: [],
    };

  const wanted = new Set(sourceIds);
  // Only drafts. Approving something already approved is not a change, and
  // "approving" something that is not there should not look like success.
  const approving = loaded.store.sources.filter(
    (source) => wanted.has(source.id) && source.status === "draft",
  );
  if (approving.length === 0)
    return {
      status: "rejected",
      summary: "Those items are not drafts, so nothing changed.",
      applied: 0,
      skipped: sourceIds.length,
      links: [],
    };

  const now = new Date().toISOString();
  const approvedIds = new Set(approving.map((source) => source.id));
  const sources = loaded.store.sources.map((source) =>
    approvedIds.has(source.id)
      ? { ...source, status: "approved" as const, updatedAt: now }
      : source,
  );

  const saved = await saveDocument(db, workspace, KEY, loaded.version, {
    ...loaded.store,
    sources,
  });
  if (!saved.ok)
    return {
      status: "failed",
      summary:
        saved.reason === "conflict"
          ? "Your knowledge changed while you were reading this. Nothing was approved."
          : "Those items could not be approved.",
      applied: 0,
      skipped: sourceIds.length,
      links: [],
    };

  return {
    status: "applied",
    summary: `${approving.length} item${approving.length === 1 ? "" : "s"} are now approved. Your crew may use ${approving.length === 1 ? "it" : "them"} from the next message.`,
    applied: approving.length,
    skipped: sourceIds.length - approving.length,
    links: [{ label: "Open Knowledge", href: "/app/knowledge" }],
    undo: {
      token: JSON.stringify({ k: KEY, unapprove: [...approvedIds] }),
      action: "knowledge_approve_items",
      expiresAt: Date.now() + 60 * 60 * 1000,
      describes: `${approving.length} approved item${approving.length === 1 ? "" : "s"}`,
    },
  };
}

/**
 * Puts back what an action did, where that is genuinely possible.
 *
 * Only ever removes drafts it added or returns items to draft. It will not
 * delete approved knowledge: a token is a convenience, not an authority, and
 * the worst a stale or tampered one can do is nothing.
 */
export async function undoKnowledgeChange(
  db: SupabaseClient,
  workspace: WorkspaceContext,
  token: string,
): Promise<ActionResult> {
  let parsed: { k?: string; ids?: string[]; unapprove?: string[] };
  try {
    parsed = JSON.parse(token) as typeof parsed;
  } catch {
    return {
      status: "failed",
      summary: "That undo is no longer valid.",
      applied: 0,
      skipped: 0,
      links: [],
    };
  }
  if (parsed.k !== KEY)
    return {
      status: "failed",
      summary: "That undo is no longer valid.",
      applied: 0,
      skipped: 0,
      links: [],
    };

  const loaded = await loadStore(db, workspace);
  if (!loaded)
    return {
      status: "failed",
      summary: "Your knowledge could not be read.",
      applied: 0,
      skipped: 0,
      links: [],
    };

  const now = new Date().toISOString();
  let sources = loaded.store.sources;
  let touched = 0;

  if (parsed.ids?.length) {
    const remove = new Set(parsed.ids);
    const before = sources.length;
    // Drafts only: if the owner approved one in the meantime, it is theirs.
    sources = sources.filter(
      (source) => !(remove.has(source.id) && source.status === "draft"),
    );
    touched = before - sources.length;
  } else if (parsed.unapprove?.length) {
    const back = new Set(parsed.unapprove);
    sources = sources.map((source) => {
      if (!back.has(source.id) || source.status !== "approved") return source;
      touched++;
      return { ...source, status: "draft" as const, updatedAt: now };
    });
  }

  if (touched === 0)
    return {
      status: "rejected",
      summary: "Nothing to undo — those items have already changed.",
      applied: 0,
      skipped: 0,
      links: [],
    };

  const saved = await saveDocument(db, workspace, KEY, loaded.version, {
    ...loaded.store,
    sources,
  });
  if (!saved.ok)
    return {
      status: "failed",
      summary: "That could not be undone.",
      applied: 0,
      skipped: 0,
      links: [],
    };

  return {
    status: "applied",
    summary: `Undone — ${touched} item${touched === 1 ? "" : "s"} put back.`,
    applied: touched,
    skipped: 0,
    links: [{ label: "Open Knowledge", href: "/app/knowledge" }],
  };
}

export type { ChangeSet };
