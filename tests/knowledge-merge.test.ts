import { describe, expect, it } from "vitest";

import { createKnowledgeStoreFromBusiness } from "../lib/knowledge";
import { sampleBusiness } from "../lib/business";
import { mergeSuggestions } from "../lib/knowledge-merge";

const file = { id: "6f9619ff-8b86-4d11-b42d-00c04fc964ff", kind: "url" as const, fileName: null };

describe("suggestions from files and links", () => {
  const base = createKnowledgeStoreFromBusiness(sampleBusiness, "2026-10-19T00:00:00.000Z");

  it("adds new suggestions as drafts linked to the file", () => {
    const merged = mergeSuggestions(base, file, [{ kind: "service", title: "Haircut", content: "Wash and cut", price: "$60" }]);
    const added = merged.sources.at(-1)!;
    expect(merged.added).toBe(1);
    expect(added).toMatchObject({ status: "draft", fileId: file.id, origin: "website", price: "$60" });
  });

  it("skips unchanged items and proposes updates for changed ones", () => {
    const first = mergeSuggestions(base, file, [
      { kind: "service", title: "Haircut", content: "Wash and cut", price: "$60" },
      { kind: "faq", title: "Parking?", content: "Free behind the salon" },
    ]);
    const live = { ...first, sources: first.sources.map((s) => (s.fileId ? { ...s, status: "approved" as const } : s)) };
    const store = { ...base, sources: live.sources };
    const again = mergeSuggestions(store, file, [
      { kind: "service", title: "haircut", content: "Wash and cut", price: "$65" },
      { kind: "faq", title: "Parking?", content: "Free behind the salon" },
    ]);
    expect(again.added).toBe(1);
    expect(again.updates).toBe(1);
    const update = again.sources.at(-1)!;
    const original = store.sources.find((s) => s.title === "Haircut")!;
    expect(update.replacesId).toBe(original.id);
    expect(update.price).toBe("$65");
    // A newer refresh replaces the older pending update instead of piling up.
    const third = mergeSuggestions({ ...base, sources: again.sources }, file, [
      { kind: "service", title: "Haircut", content: "Wash and cut", price: "$70" },
    ]);
    expect(third.sources.filter((s) => s.replacesId === original.id)).toHaveLength(1);
  });
});
