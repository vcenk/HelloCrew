import {
  MAX_KNOWLEDGE_ITEMS,
  type KnowledgeSource,
  type KnowledgeStore,
} from "./knowledge";

export type SuggestionInput = {
  kind: KnowledgeSource["kind"];
  title: string;
  content: string;
  price?: string;
};
type SourceFile = { id: string; kind: "file" | "url"; fileName: string | null };

const limits = { service: 80, faq: 160 } as Record<string, number>;

const norm = (v: string | undefined) =>
  (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

// Adds AI suggestions as drafts linked to their file. A suggestion matching an
// existing item from the same file becomes a proposed update (or is skipped
// when nothing changed), so refreshing a link never duplicates items.
export function mergeSuggestions(
  store: KnowledgeStore,
  file: SourceFile,
  suggestions: SuggestionInput[],
) {
  const now = new Date().toISOString();
  const fromFile = store.sources.filter(
    (s) => s.fileId === file.id && !s.replacesId,
  );
  const added: KnowledgeSource[] = [];
  let updates = 0;
  for (const s of suggestions) {
    const title = s.title.slice(0, limits[s.kind] ?? 180);
    const content = s.content.slice(0, 12000);
    const price =
      s.kind === "service" && s.price ? s.price.slice(0, 80) : undefined;
    const existing = fromFile.find(
      (e) => e.kind === s.kind && norm(e.title) === norm(title),
    );
    if (
      existing &&
      norm(existing.content) === norm(content) &&
      norm(existing.price) === norm(price)
    )
      continue;
    if (added.some((a) => a.kind === s.kind && norm(a.title) === norm(title)))
      continue;
    // Drop an older pending update for the same item.
    if (existing) updates++;
    added.push({
      id: `source-${crypto.randomUUID()}`,
      kind: s.kind,
      language: "en",
      status: "draft",
      origin: file.kind === "url" ? "website" : "upload",
      title,
      content,
      ...(price ? { price } : {}),
      ...(file.fileName ? { fileName: file.fileName.slice(0, 240) } : {}),
      fileId: file.id,
      ...(existing ? { replacesId: existing.id } : {}),
      updatedAt: now,
    });
  }
  const replacedIds = new Set(added.map((a) => a.replacesId).filter(Boolean));
  const kept = store.sources.filter(
    (s) => !(s.replacesId && replacedIds.has(s.replacesId)),
  );
  const room = Math.max(0, MAX_KNOWLEDGE_ITEMS - kept.length);
  return {
    sources: [...kept, ...added.slice(0, room)],
    added: Math.min(added.length, room),
    updates,
    skipped: Math.max(0, added.length - room),
  };
}
