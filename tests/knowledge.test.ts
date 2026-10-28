import { describe, expect, it } from "vitest";

import { sampleBusiness } from "../lib/business";
import {
  businessFromKnowledge,
  countLanguageCoverage,
  createKnowledgeStoreFromBusiness,
  parseKnowledgeStore,
  searchApprovedKnowledge,
} from "../lib/knowledge";

const NOW = "2026-10-12T12:00:00.000Z";

describe("knowledge library", () => {
  it("creates valid, approved sources from the practice profile", () => {
    const store = createKnowledgeStoreFromBusiness(sampleBusiness, NOW);
    expect(parseKnowledgeStore(store).success).toBe(true);
    expect(countLanguageCoverage(store)).toEqual({ en: 3, fa: 0, zh: 0 });
  });

  it("retrieves approved exact FAQs ahead of keyword matches", () => {
    const store = createKnowledgeStoreFromBusiness(sampleBusiness, NOW);
    const matches = searchApprovedKnowledge(
      store,
      "Is parking available?",
      "en",
    );
    expect(matches[0]).toMatchObject({
      score: 1,
      reason: "Exact approved FAQ",
      source: { kind: "faq" },
    });
  });

  it("never retrieves draft or outdated sources", () => {
    const store = createKnowledgeStoreFromBusiness(sampleBusiness, NOW);
    store.sources.push({
      id: "draft-secret",
      kind: "policy",
      language: "en",
      status: "draft",
      origin: "manual",
      title: "Refund policy",
      content: "Draft refund policy text",
      updatedAt: NOW,
    });
    expect(searchApprovedKnowledge(store, "refund policy", "en")).toEqual([]);
    store.sources.at(-1)!.status = "outdated";
    expect(searchApprovedKnowledge(store, "refund policy", "en")).toEqual([]);
  });

  it("builds the conversation profile from approved sources only", () => {
    const store = createKnowledgeStoreFromBusiness(sampleBusiness, NOW);
    store.sources.find((source) => source.kind === "faq")!.status = "outdated";
    const profile = businessFromKnowledge(store);
    expect(profile.faqs).toEqual([]);
    expect(profile.services).toEqual(sampleBusiness.services);
  });

  it("supports Farsi and Mandarin source matching", () => {
    const store = createKnowledgeStoreFromBusiness(sampleBusiness, NOW);
    store.sources.push(
      {
        id: "fa-hours",
        kind: "hours",
        language: "fa",
        status: "approved",
        origin: "manual",
        title: "ساعات کاری",
        content: "دوشنبه تا جمعه، ۹ تا ۵",
        updatedAt: NOW,
      },
      {
        id: "zh-hours",
        kind: "hours",
        language: "zh",
        status: "approved",
        origin: "manual",
        title: "营业时间",
        content: "周一至周五，上午九点至下午五点",
        updatedAt: NOW,
      },
    );
    expect(searchApprovedKnowledge(store, "ساعات کاری", "fa")[0].score).toBe(
      0.9,
    );
    expect(searchApprovedKnowledge(store, "营业时间", "zh")[0].score).toBe(0.9);
  });
});

describe("a service's length travels with it", () => {
  it("survives the knowledge store round trip", () => {
    const store = createKnowledgeStoreFromBusiness(sampleBusiness);
    const services = store.sources.filter((s) => s.kind === "service");
    expect(services.length).toBeGreaterThan(0);
    const withMinutes = {
      ...store,
      sources: store.sources.map((s) =>
        s.kind === "service" ? { ...s, minutes: 90 } : s,
      ),
    };
    const parsed = parseKnowledgeStore(withMinutes);
    expect(parsed.success).toBe(true);
    if (parsed.success)
      expect(
        parsed.data.sources.find((s) => s.kind === "service")?.minutes,
      ).toBe(90);
  });

  it("reaches the crew through the business profile", () => {
    const store = createKnowledgeStoreFromBusiness(sampleBusiness);
    const business = businessFromKnowledge({
      ...store,
      sources: store.sources.map((s) =>
        s.kind === "service" ? { ...s, minutes: 45 } : s,
      ),
    });
    expect(business.services[0].minutes).toBe(45);
  });

  it("is simply absent for a service nobody timed", () => {
    // Setting one must never be a step between connecting and booking.
    const store = createKnowledgeStoreFromBusiness(sampleBusiness);
    expect(businessFromKnowledge(store).services[0].minutes).toBeUndefined();
  });

  it("refuses a length no appointment could be", () => {
    const store = createKnowledgeStoreFromBusiness(sampleBusiness);
    for (const minutes of [0, 4, 481, 1.5])
      expect(
        parseKnowledgeStore({
          ...store,
          sources: store.sources.map((s) =>
            s.kind === "service" ? { ...s, minutes } : s,
          ),
        }).success,
        String(minutes),
      ).toBe(false);
  });
});
