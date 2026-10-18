import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { describe, expect, it } from "vitest";

import { buildAgentContext } from "../lib/agent/context";
import { runAgentTurn, MAX_MODEL_ROUNDS } from "../lib/agent/graph";
import { buildSystemPrompt } from "../lib/agent/prompt";
import { sampleAssistantIdentity } from "../lib/assistant";
import { sampleBusiness } from "../lib/business";
import { createKnowledgeStoreFromBusiness } from "../lib/knowledge";
import { costMicroUsd, worstCaseMicroUsd } from "../lib/usage/cost";
import { readLiveConfig } from "../lib/server/live-config";

// Scripted chat model: returns the queued AI messages in order and records
// what it was shown, so tests exercise the real graph without network calls.
function scriptedModel(script: AIMessage[]) {
  const seen: BaseMessage[][] = [];
  let toolsBound = 0;
  const runnable = {
    invoke: async (messages: BaseMessage[]) => {
      seen.push(messages);
      const next = script.shift();
      if (!next) throw new Error("script exhausted");
      return next;
    },
  };
  const model = {
    ...runnable,
    bindTools: () => {
      toolsBound++;
      return runnable;
    },
  } as unknown as BaseChatModel;
  return { model, seen, bound: () => toolsBound };
}

const context = buildAgentContext(
  sampleAssistantIdentity,
  createKnowledgeStoreFromBusiness(sampleBusiness),
  new Date("2026-10-17T12:00:00Z"),
);

describe("live agent graph", () => {
  it("grounds the prompt in approved knowledge and the identity", () => {
    const prompt = buildSystemPrompt(context);
    expect(prompt).toContain(sampleAssistantIdentity.name);
    expect(prompt).toContain("two visitor parking spaces");
    expect(prompt).toContain("untrusted");
  });

  it("answers directly and reports token usage", async () => {
    const { model } = scriptedModel([
      new AIMessage({
        content: "We have two visitor parking spaces.",
        usage_metadata: {
          input_tokens: 900,
          output_tokens: 20,
          total_tokens: 920,
        },
      }),
    ]);
    const result = await runAgentTurn(model, context, [
      { role: "user", content: "Is there parking?" },
    ]);
    expect(result.reply).toBe("We have two visitor parking spaces.");
    expect(result.usage).toEqual({
      inputTokens: 900,
      outputTokens: 20,
      modelRounds: 1,
    });
    expect(result.approvals).toEqual([]);
  });

  it("turns a booking into an owner approval instead of booking", async () => {
    const { model, seen } = scriptedModel([
      new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "call_1",
            name: "request_booking",
            args: { service: "Studio visit", preferredTime: "Friday 3pm" },
          },
        ],
      }),
      new AIMessage({
        content: "I've sent your request; the studio will confirm.",
      }),
    ]);
    const result = await runAgentTurn(model, context, [
      { role: "user", content: "Book me a studio visit Friday 3pm" },
    ]);
    expect(result.approvals).toHaveLength(1);
    expect(result.approvals[0].summary).toBe("Studio visit, Friday 3pm");
    expect(result.activity.some((a) => a.kind === "approval")).toBe(true);
    const toolResult = seen[1].at(-1);
    expect(String(toolResult?.content)).toContain("awaiting_owner_approval");
  });

  it("blocks unknown tools and invalid arguments", async () => {
    const { model } = scriptedModel([
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "a", name: "send_payment", args: { amount: 500 } },
          { id: "b", name: "request_booking", args: { service: "" } },
        ],
      }),
      new AIMessage({ content: "A person will help with that." }),
    ]);
    const result = await runAgentTurn(model, context, [
      { role: "user", content: "Pay 500 and book" },
    ]);
    expect(result.approvals).toEqual([]);
    expect(result.activity.filter((a) => a.kind === "error")).toHaveLength(2);
  });

  it("stops calling tools after the round limit", async () => {
    const loop = () =>
      new AIMessage({
        content: "",
        tool_calls: [
          { id: crypto.randomUUID(), name: "get_business_details", args: {} },
        ],
      });
    const { model, seen } = scriptedModel([
      loop(),
      loop(),
      new AIMessage({ content: "Here are our hours." }),
    ]);
    const result = await runAgentTurn(model, context, [
      { role: "user", content: "hours?" },
    ]);
    expect(seen).toHaveLength(MAX_MODEL_ROUNDS);
    expect(result.reply).toBe("Here are our hours.");
  });

  it("declines off-topic questions gently without asking the owner to teach", async () => {
    expect(buildSystemPrompt(context)).toContain("Off-topic questions");
    const { model } = scriptedModel([
      new AIMessage({
        content: `I can only help with questions about ${sampleBusiness.name}, like our hours, prices or booking a visit.`,
      }),
    ]);
    const result = await runAgentTurn(model, context, [
      { role: "user", content: "Who is the president of the USA?" },
    ]);
    expect(result.reply).toContain("I can only help");
    expect(result.unanswered).toBe(false);
  });

  it("falls back to the identity's safe answer when the model is silent", async () => {
    const { model } = scriptedModel([new AIMessage({ content: "" })]);
    const result = await runAgentTurn(model, context, [
      { role: "user", content: "?" },
    ]);
    expect(result.reply).toBe(sampleAssistantIdentity.fallback);
  });
});

describe("live AI cost accounting", () => {
  it("prices tokens in whole micro-dollars, rounding up", () => {
    expect(costMicroUsd(1_000_000, 0, 0.15, 0.6)).toBe(150_000);
    expect(costMicroUsd(1, 1, 0.15, 0.6)).toBe(1);
  });

  it("reserves at least the cost of every possible round", () => {
    const worst = worstCaseMicroUsd({
      promptChars: 6000,
      rounds: 3,
      maxOutputTokens: 1200,
      inputUsdPerMTok: 0.15,
      outputUsdPerMTok: 0.6,
    });
    const oneRound = costMicroUsd(2600, 1200, 0.15, 0.6);
    expect(worst).toBeGreaterThan(oneRound * 3);
    expect(worst).toBeLessThan(10_000); // under one cent for gpt-4o-mini
  });

  it("stays off until both server keys exist", () => {
    expect(readLiveConfig({})).toEqual({
      ready: false,
      missing: ["openai_key", "supabase_secret"],
    });
    const ready = readLiveConfig({
      OPENAI_API_KEY: "k",
      SUPABASE_SECRET_KEY: "s",
    });
    expect(ready.ready && ready.config.model).toBe("gpt-4o-mini");
  });
});

describe("crew skills control the live agent", () => {
  it("does not offer booking or handoff tools when switched off", async () => {
    const { buildTools } = await import("../lib/agent/tools");
    const off = buildAgentContext(
      sampleAssistantIdentity,
      createKnowledgeStoreFromBusiness(sampleBusiness),
      new Date(),
      { answer: "auto", booking: "off", handoff: "off", leads: "off" },
    );
    const names = buildTools(off, { approvals: [], handoffs: [] }).map((t) => t.name);
    expect(names).toEqual(["search_knowledge", "get_business_details"]);
    expect(buildSystemPrompt(off)).toContain("You cannot take bookings");
    const on = buildTools(context, { approvals: [], handoffs: [] }).map((t) => t.name);
    expect(on).toContain("request_booking");
    expect(on).toContain("handoff_to_human");
  });

  it("clamps stored skills to modes allowed today", async () => {
    const { parseCrewStore, setSkillMode, defaultCrew } = await import("../lib/crew");
    const stored = parseCrewStore({
      formatVersion: 1,
      members: [
        {
          id: "receptionist",
          job: "receptionist",
          skills: { answer: "off", booking: "auto", handoff: "auto", leads: "auto" },
        },
      ],
    });
    expect(stored.members[0].skills).toEqual(defaultCrew.members[0].skills);
    expect(parseCrewStore("junk")).toEqual(defaultCrew);
    const changed = setSkillMode(defaultCrew, "booking", "off");
    expect(changed.members[0].skills.booking).toBe("off");
    expect(setSkillMode(defaultCrew, "booking", "auto")).toBe(defaultCrew);
  });
});
