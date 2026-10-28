import { describe, expect, it } from "vitest";

import {
  applySelected,
  buildKnowledgeChangeSet,
  type SourceFile,
} from "../lib/copilot/knowledge-changes";
import { sampleBusiness } from "../lib/business";
import {
  createKnowledgeStoreFromBusiness,
  type KnowledgeSource,
  type KnowledgeStore,
} from "../lib/knowledge";
import type { SuggestionInput } from "../lib/knowledge-merge";

const file: SourceFile = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "file",
  fileName: "prices-2026.pdf",
  title: "Prices 2026",
};

const build = (store: KnowledgeStore, suggestions: SuggestionInput[]) =>
  buildKnowledgeChangeSet({ id: "cs1", store, file, suggestions });

/** An approved service already in the store, so conflicts have something to hit. */
function storeWithApproved(
  title: string,
  content: string,
  price?: string,
): KnowledgeStore {
  const base = createKnowledgeStoreFromBusiness(sampleBusiness);
  const existing: KnowledgeSource = {
    id: "source-existing",
    kind: "service",
    language: "en",
    status: "approved",
    origin: "manual",
    title,
    content,
    ...(price ? { price } : {}),
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  return { ...base, sources: [...base.sources, existing] };
}

describe("reading a document into something to decide on", () => {
  it("proposes what was found, as drafts", () => {
    const store = createKnowledgeStoreFromBusiness(sampleBusiness);
    const { changes } = build(store, [
      { kind: "service", title: "Colour", content: "Full colour", price: "$120" },
    ]);

    expect(changes.operations).toHaveLength(1);
    expect(changes.operations[0].kind).toBe("add");
    expect(changes.operations[0].after).toContain("$120");
    // Drafts are not used by anyone until approved.
    expect(changes.affectsLiveBehaviour).toBe(false);
    expect(changes.summary).toMatch(/nothing is live until you approve/i);
  });

  it("says plainly when a document held nothing new", () => {
    const store = createKnowledgeStoreFromBusiness(sampleBusiness);
    const { changes } = build(store, []);
    expect(changes.operations).toEqual([]);
    expect(changes.summary).toMatch(/nothing new/i);
  });

  it("carries the extraction note through to the owner", () => {
    const store = createKnowledgeStoreFromBusiness(sampleBusiness);
    const { changes } = buildKnowledgeChangeSet({
      id: "cs1",
      store,
      file,
      suggestions: [],
      note: "This month's AI budget is used up.",
    });
    expect(changes.notes).toContain("This month's AI budget is used up.");
  });
});

describe("disagreeing with knowledge already approved", () => {
  it("is flagged as a conflict, not applied quietly", () => {
    // The case that matters: this year's price list against last year's price.
    const store = storeWithApproved("Colour", "Full colour", "$120");
    const { changes } = build(store, [
      { kind: "service", title: "Colour", content: "Full colour", price: "$150" },
    ]);

    const [operation] = changes.operations;
    expect(operation.conflict).toBeTruthy();
    expect(operation.conflict!.explanation).toContain("$120");
  });

  it("starts switched off, so clicking through cannot contradict you", () => {
    const store = storeWithApproved("Colour", "Full colour", "$120");
    const { changes } = build(store, [
      { kind: "service", title: "Colour", content: "Full colour", price: "$150" },
    ]);
    expect(changes.operations[0].selected).toBe(false);
    expect(changes.notes.join(" ")).toMatch(/switched off/i);
  });

  it("is not raised against a draft", () => {
    // Two drafts disagreeing is not a conflict; nobody is using either.
    const base = createKnowledgeStoreFromBusiness(sampleBusiness);
    const store: KnowledgeStore = {
      ...base,
      sources: [
        ...base.sources,
        {
          id: "source-draft",
          kind: "service",
          language: "en",
          status: "draft",
          origin: "manual",
          title: "Colour",
          content: "Full colour",
          price: "$120",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    const { changes } = build(store, [
      { kind: "service", title: "Colour", content: "Full colour", price: "$150" },
    ]);
    expect(changes.operations[0].conflict).toBeUndefined();
  });

  it("is not raised against the item it is replacing", () => {
    // Re-reading the same file is an update, and is shown as one.
    const store = createKnowledgeStoreFromBusiness(sampleBusiness);
    const first = build(store, [
      { kind: "service", title: "Colour", content: "Full colour", price: "$120" },
    ]);
    const afterFirst: KnowledgeStore = { ...store, sources: first.merged };

    const second = build(afterFirst, [
      { kind: "service", title: "Colour", content: "Full colour", price: "$150" },
    ]);
    expect(second.changes.operations[0].kind).toBe("update");
    expect(second.changes.operations[0].conflict).toBeUndefined();
    expect(second.changes.operations[0].before).toContain("$120");
  });
});

describe("something already approved and identical", () => {
  it("is marked a duplicate and left off", () => {
    const store = storeWithApproved("Colour", "Full colour", "$120");
    const { changes } = build(store, [
      { kind: "service", title: "Colour", content: "Full colour", price: "$120" },
    ]);

    expect(changes.operations[0].duplicate).toBe(true);
    expect(changes.operations[0].selected).toBe(false);
    expect(changes.operations[0].conflict).toBeUndefined();
  });

  it("ignores case and spacing when deciding", () => {
    const store = storeWithApproved("Colour", "Full colour", "$120");
    const { changes } = build(store, [
      { kind: "service", title: " colour ", content: "Full  colour", price: "$120" },
    ]);
    expect(changes.operations[0].duplicate).toBe(true);
  });
});

describe("applying only what the owner kept", () => {
  const store = createKnowledgeStoreFromBusiness(sampleBusiness);
  const suggestions: SuggestionInput[] = [
    { kind: "service", title: "Colour", content: "Full colour", price: "$120" },
    { kind: "faq", title: "Do you do perms?", content: "Yes, by appointment." },
  ];

  it("writes the chosen ones and nothing else", () => {
    const plan = build(store, suggestions);
    const keep = plan.changes.operations[0].id;
    const sources = applySelected(store, plan, [keep]);

    const added = sources.filter(
      (source) => !store.sources.some((old) => old.id === source.id),
    );
    expect(added).toHaveLength(1);
    expect(added[0].title).toBe("Colour");
  });

  it("keeps the store untouched when nothing is chosen", () => {
    const plan = build(store, suggestions);
    expect(applySelected(store, plan, [])).toEqual(store.sources);
  });

  it("lets the owner correct an item before it is written", () => {
    const plan = build(store, suggestions);
    const id = plan.changes.operations[0].id;
    const sources = applySelected(store, plan, [id], {
      [id]: { price: "$130" },
    });
    expect(sources.find((source) => source.id === id)?.price).toBe("$130");
  });

  it("everything it writes is a draft", () => {
    // The whole guarantee: reading a document never approves anything.
    const plan = build(store, suggestions);
    const ids = plan.changes.operations.map((operation) => operation.id);
    for (const source of applySelected(store, plan, ids))
      if (ids.includes(source.id)) expect(source.status).toBe("draft");
  });

  it("only removes what a kept operation replaces", () => {
    const plan = build(store, suggestions);
    const first = build(store, suggestions);
    const afterFirst: KnowledgeStore = { ...store, sources: first.merged };
    const second = build(afterFirst, [
      { kind: "service", title: "Colour", content: "Full colour", price: "$150" },
    ]);

    // Keep nothing: the earlier item must survive untouched.
    const sources = applySelected(afterFirst, second, []);
    expect(sources).toEqual(afterFirst.sources);
    expect(plan.changes.operations.length).toBeGreaterThan(0);
  });
});

/**
 * The owner is shown a plan, thinks about it, then sends back the ids they
 * kept — and the server re-plans to apply them. If those two plans do not
 * agree on ids, every choice they made refers to nothing and the whole flow
 * silently does nothing. It did, until the ids stopped being random.
 */
describe("the ids survive the round trip", () => {
  const store = createKnowledgeStoreFromBusiness(sampleBusiness);
  const suggestions: SuggestionInput[] = [
    { kind: "service", title: "Colour", content: "Full colour", price: "$120" },
    { kind: "faq", title: "Do you do perms?", content: "Yes, by appointment." },
  ];

  it("planning the same document twice gives the same ids", () => {
    const first = build(store, suggestions).changes.operations.map((o) => o.id);
    const second = build(store, suggestions).changes.operations.map((o) => o.id);
    expect(second).toEqual(first);
    expect(new Set(first).size).toBe(first.length);
  });

  it("applying ids from an earlier plan still works", () => {
    const shown = build(store, suggestions);
    const kept = [shown.changes.operations[0].id];

    // What the server does on apply: a fresh plan from the same inputs.
    const replanned = build(store, suggestions);
    const sources = applySelected(store, replanned, kept);

    expect(
      sources.some((source) => source.id === kept[0]),
      "the item the owner kept was written",
    ).toBe(true);
  });

  it("different documents do not collide", () => {
    const other = build(store, suggestions);
    const fromOtherFile = buildKnowledgeChangeSet({
      id: "cs2",
      store,
      file: { ...file, id: "22222222-2222-4222-8222-222222222222" },
      suggestions,
    });
    for (const id of fromOtherFile.changes.operations.map((o) => o.id))
      expect(other.changes.operations.map((o) => o.id)).not.toContain(id);
  });
});
