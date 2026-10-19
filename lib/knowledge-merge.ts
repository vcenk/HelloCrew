import {
  MAX_KNOWLEDGE_ITEMS,
  priceSummary,
  type KnowledgeSource,
  type KnowledgeStore,
  type PriceOption,
  type TeamMember,
} from "./knowledge";

export type SuggestionInput = {
  kind: KnowledgeSource["kind"];
  title: string;
  content: string;
  price?: string;
  options?: { who: string; price: string; duration?: string }[];
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
    const options =
      s.kind === "service"
        ? optionsFromSuggestion(s.options, store.team ?? [])
        : undefined;
    const price =
      s.kind === "service"
        ? (options ? priceSummary(options) : s.price?.slice(0, 80)) || undefined
        : undefined;
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
      ...(options ? { options } : {}),
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

// "Ayşe" or "Ayşe Yılmaz" in a document matches the team member Ayşe;
// anything else (a level or an option like "Long hair") stays a named option.
export function optionsFromSuggestion(
  options: SuggestionInput["options"],
  team: TeamMember[],
): PriceOption[] | undefined {
  if (!options?.length) return undefined;
  return options.slice(0, 12).map((o) => {
    const who = norm(o.who);
    const member = team.find((m) => {
      const name = norm(m.name);
      return (
        who === name || who.split(" ")[0] === name || name.split(" ")[0] === who
      );
    });
    return {
      ...(member ? { staffId: member.id } : { label: o.who.slice(0, 80) }),
      price: o.price.slice(0, 40),
      ...(o.duration ? { duration: o.duration.slice(0, 40) } : {}),
    };
  });
}
