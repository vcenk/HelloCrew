import { mergeSuggestions, type SuggestionInput } from "@/lib/knowledge-merge";
import type { KnowledgeSource, KnowledgeStore } from "@/lib/knowledge";
import type { ChangeOperation, ChangeSet } from "./contracts";

/**
 * Turns what was read out of a document into something an owner can decide on.
 *
 * mergeSuggestions already works out what to add, recognises items it has seen
 * from the same file before, and lands everything as a draft. What it does not
 * do — and what matters when an owner uploads this year's price list — is
 * notice that an item disagrees with knowledge the crew is already approved to
 * use. That is the job here.
 */

/** Matches lib/knowledge-merge's own shape, plus a title for the card. */
export type SourceFile = {
  id: string;
  kind: "file" | "url";
  fileName: string | null;
  title: string;
};

const norm = (value: string | undefined) =>
  (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * An id that is the same every time this document produces this item.
 *
 * mergeSuggestions mints a fresh uuid per item, which is right when the
 * browser applies its own result straight away. Here the owner is shown a
 * plan, thinks about it, and sends back the ids they kept — so the server
 * re-planning must land on the same ids, or every choice they made refers to
 * nothing. Derived from the file and the item rather than stored, because
 * there is nowhere to store it between the two requests.
 */
function stableId(fileId: string, kind: string, title: string): string {
  const key = `${fileId}|${kind}|${norm(title)}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index++) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const slug = norm(title).replace(/[^a-z0-9]+/g, "-").slice(0, 24);
  return `source-${hash.toString(16).padStart(8, "0")}-${slug || kind}`;
}

/** What the owner reads on the card: the content, and the price if there is one. */
function describe(source: KnowledgeSource): string {
  const price = source.price ? ` — ${source.price}` : "";
  return `${source.content}${price}`.slice(0, 2_000);
}

/** Same thing, said the same way: applying it would change nothing. */
function isSameAs(a: KnowledgeSource, b: KnowledgeSource) {
  return (
    norm(a.content) === norm(b.content) && norm(a.price) === norm(b.price)
  );
}

/**
 * Knowledge the crew is already allowed to use that this item contradicts.
 *
 * Only approved sources count. A draft disagreeing with a draft is not a
 * conflict, it is two drafts. And an item that replaces a known one is an
 * update, which the owner is already being shown as such.
 */
function conflictFor(
  candidate: KnowledgeSource,
  store: KnowledgeStore,
): KnowledgeSource | null {
  return (
    store.sources.find(
      (existing) =>
        existing.status === "approved" &&
        existing.id !== candidate.replacesId &&
        existing.kind === candidate.kind &&
        norm(existing.title) === norm(candidate.title) &&
        !isSameAs(existing, candidate),
    ) ?? null
  );
}

/** Already approved and identical, so there is nothing to apply. */
function duplicateOf(
  candidate: KnowledgeSource,
  store: KnowledgeStore,
): KnowledgeSource | null {
  return (
    store.sources.find(
      (existing) =>
        existing.status === "approved" &&
        existing.kind === candidate.kind &&
        norm(existing.title) === norm(candidate.title) &&
        isSameAs(existing, candidate),
    ) ?? null
  );
}

const KIND_LABEL: Record<string, string> = {
  hours: "Opening hours",
  service: "Service",
  faq: "Question",
  policy: "Policy",
  document: "Document",
};

export type KnowledgeChangePlan = {
  changes: ChangeSet;
  /** The merged store to save when every operation is kept. */
  merged: KnowledgeSource[];
  /** The proposed sources, keyed by operation id, for applying a subset. */
  byOperation: Map<string, KnowledgeSource>;
};

export function buildKnowledgeChangeSet(input: {
  id: string;
  store: KnowledgeStore;
  file: SourceFile;
  suggestions: SuggestionInput[];
  /** Said plainly on the card when extraction had something to report. */
  note?: string | null;
}): KnowledgeChangePlan {
  const { store, file, suggestions } = input;
  const result = mergeSuggestions(store, file, suggestions);

  const before = new Set(store.sources.map((source) => source.id));
  const proposed = result.sources
    .filter((source) => !before.has(source.id))
    // Nothing references these yet, so renaming them is safe — and it is what
    // makes the owner's decision survive the round trip.
    .map((source) => ({
      ...source,
      id: stableId(file.id, source.kind, source.title),
    }));
  const merged = [
    ...result.sources.filter((source) => before.has(source.id)),
    ...proposed,
  ];

  const byOperation = new Map<string, KnowledgeSource>();
  const operations: ChangeOperation[] = proposed.map((source) => {
    const replaced = source.replacesId
      ? store.sources.find((existing) => existing.id === source.replacesId)
      : undefined;
    const conflict = conflictFor(source, store);
    const duplicate = duplicateOf(source, store);
    const label = KIND_LABEL[source.kind] ?? source.kind;

    byOperation.set(source.id, source);
    return {
      id: source.id,
      kind: replaced ? "update" : "add",
      resource: "knowledge",
      title: `${label}: ${source.title}`,
      summary: replaced
        ? `Updates what this document said before.`
        : `New from ${file.fileName ?? file.title}.`,
      ...(replaced ? { before: describe(replaced) } : {}),
      after: describe(source),
      ...(conflict
        ? {
            conflict: {
              withTitle: conflict.title,
              explanation: `Your approved knowledge says "${describe(conflict).slice(0, 160)}". Applying this would leave both.`,
            },
          }
        : {}),
      duplicate: Boolean(duplicate),
      // A conflicting or duplicate item starts off, so an owner clicking
      // straight through never silently contradicts themselves.
      selected: !conflict && !duplicate,
    };
  });

  const notes: string[] = [];
  if (input.note) notes.push(input.note);
  if (result.skipped > 0)
    notes.push(
      `${result.skipped} item${result.skipped === 1 ? "" : "s"} did not fit — your knowledge is at its limit.`,
    );
  const conflicts = operations.filter((operation) => operation.conflict).length;
  if (conflicts > 0)
    notes.push(
      `${conflicts} item${conflicts === 1 ? "" : "s"} disagree with knowledge you have already approved, so ${conflicts === 1 ? "it is" : "they are"} switched off below.`,
    );

  return {
    changes: {
      id: input.id,
      action: "knowledge_add_from_document",
      title: `From ${file.fileName ?? file.title}`,
      summary:
        proposed.length === 0
          ? "Nothing new was found in this document."
          : `Found ${proposed.length} item${proposed.length === 1 ? "" : "s"}. They arrive as drafts — nothing is live until you approve it.`,
      operations,
      affectsCrew: [],
      // Drafts are not used by anyone until approved, so this cannot change
      // what a customer is told.
      affectsLiveBehaviour: false,
      notes,
    },
    merged,
    byOperation,
  };
}

/**
 * The store as it would be with only the chosen operations applied.
 *
 * Built from the original store rather than from the merged one, so an
 * operation the owner switched off leaves nothing behind.
 */
export function applySelected(
  store: KnowledgeStore,
  plan: KnowledgeChangePlan,
  operationIds: readonly string[],
  edits?: Record<
    string,
    { title?: string; content?: string; price?: string } | undefined
  >,
): KnowledgeSource[] {
  const chosen = operationIds
    .map((id) => plan.byOperation.get(id))
    .filter((source): source is KnowledgeSource => Boolean(source))
    .map((source) => {
      const edit = edits?.[source.id];
      if (!edit) return source;
      return {
        ...source,
        ...(edit.title ? { title: edit.title.slice(0, 180) } : {}),
        ...(edit.content ? { content: edit.content.slice(0, 12_000) } : {}),
        ...(edit.price ? { price: edit.price.slice(0, 80) } : {}),
      };
    });

  // Only drop what a kept operation actually replaces.
  const replaced = new Set(
    chosen.map((source) => source.replacesId).filter(Boolean),
  );
  return [
    ...store.sources.filter((source) => !replaced.has(source.id)),
    ...chosen,
  ];
}
