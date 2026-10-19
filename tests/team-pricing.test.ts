import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import { describe, expect, it } from "vitest";

import { buildAgentContext } from "../lib/agent/context";
import { buildSystemPrompt } from "../lib/agent/prompt";
import { sampleAssistantIdentity } from "../lib/assistant";
import { sampleBusiness } from "../lib/business";
import {
  createKnowledgeStoreFromBusiness,
  describeSource,
  parseKnowledgeStore,
  priceSummary,
  searchApprovedKnowledge,
  type KnowledgeStore,
} from "../lib/knowledge";

const now = "2026-10-19T00:00:00.000Z";
const team = [
  { id: "t-ayse", name: "Ayşe", role: "Senior stylist", about: "Colour specialist", active: true },
  { id: "t-mert", name: "Mert", role: "Junior stylist", about: "", active: true },
  { id: "t-old", name: "Deniz", role: "Stylist", about: "", active: false },
];
const store: KnowledgeStore = {
  ...createKnowledgeStoreFromBusiness(sampleBusiness, now),
  team,
};
store.sources.push(
  {
    id: "source-haircut",
    kind: "service",
    language: "en",
    status: "approved",
    origin: "manual",
    title: "Haircut",
    content: "Wash, cut and style.",
    price: "$40–$60",
    options: [
      { staffId: "t-ayse", price: "$60", duration: "45 min" },
      { staffId: "t-mert", price: "$40", duration: "45 min" },
      { staffId: "t-old", price: "$50" },
    ],
    updatedAt: now,
  },
  {
    id: "source-colour-days",
    kind: "policy",
    language: "en",
    status: "approved",
    origin: "manual",
    title: "Colour appointments",
    content: "Colour only on weekdays.",
    staffIds: ["t-ayse"],
    updatedAt: now,
  },
);

describe("team and prices per staff member", () => {
  it("validates the team and options", () => {
    expect(parseKnowledgeStore(store).success).toBe(true);
    const bad = structuredClone(store);
    bad.sources.at(-2)!.options!.push({ price: "$10" });
    expect(parseKnowledgeStore(bad).success).toBe(false);
  });

  it("summarises option prices as a range", () => {
    expect(priceSummary([{ label: "Short", price: "$40" }, { label: "Long", price: "$60" }])).toBe("$40–$60");
    expect(priceSummary([{ label: "A", price: "€1,200" }, { label: "B", price: "€900" }])).toBe("€900–€1200");
    expect(priceSummary([{ label: "A", price: "50 TL" }])).toBe("50 TL");
    expect(priceSummary([{ label: "A", price: "$40" }, { label: "B", price: "ask us" }])).toBe("$40 / ask us");
  });

  it("describes options and who an item applies to, hiding inactive staff", () => {
    const haircut = describeSource(store.sources.at(-2)!, team);
    expect(haircut).toContain("Ayşe (Senior stylist) $60, 45 min");
    expect(haircut).toContain("Mert (Junior stylist) $40");
    expect(haircut).not.toContain("Deniz");
    expect(describeSource(store.sources.at(-1)!, team)).toContain("Applies to: Ayşe.");
  });

  it("finds a service by the stylist's name", () => {
    const [top] = searchApprovedKnowledge(store, "haircut with Ayşe");
    expect(top.source.id).toBe("source-haircut");
  });

  it("gives the AI the team and the per-staff prices", () => {
    const prompt = buildSystemPrompt(buildAgentContext(sampleAssistantIdentity, store, new Date(now)));
    expect(prompt).toContain("Team:\n- Ayşe, Senior stylist: Colour specialist\n- Mert, Junior stylist");
    expect(prompt).not.toContain("Deniz");
    expect(prompt).toContain("Prices: Ayşe (Senior stylist) $60, 45 min; Mert (Junior stylist) $40, 45 min.");
    expect(prompt).toContain("quote the exact price when they name someone");
  });
});
