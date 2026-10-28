import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { describe, expect, it } from "vitest";

import { buildAgentContext } from "../lib/agent/context";
import { runAgentTurn, MAX_MODEL_ROUNDS } from "../lib/agent/graph";
import { buildSystemPrompt } from "../lib/agent/prompt";
import type { IntegrationId } from "../lib/agent/tool-contract";
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

  it("searches uploaded documents when items don't answer", async () => {
    const withFiles = {
      ...context,
      searchFiles: async () => [{ title: "Price list", content: "Balayage with a senior stylist: $180" }],
    };
    const { model } = scriptedModel([
      new AIMessage({
        content: "",
        tool_calls: [{ id: "s1", name: "search_knowledge", args: { query: "balayage senior stylist" } }],
      }),
      new AIMessage({ content: "Balayage with a senior stylist is $180." }),
    ]);
    const result = await runAgentTurn(model, withFiles, [{ role: "user", content: "How much is balayage?" }]);
    expect(result.reply).toContain("$180");
    expect(result.unanswered).toBe(false);
  });

  it("captures a lead with a valid phone or email, once", async () => {
    const { model } = scriptedModel([
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "l1", name: "capture_lead", args: { name: "Sam", email: "not-an-email", interest: "Balayage quote" } },
          { id: "l2", name: "capture_lead", args: { name: "Sam", phone: "604 555 0101", interest: "Balayage quote" } },
          { id: "l3", name: "capture_lead", args: { name: "Sam", phone: "604 555 0102", interest: "Again" } },
        ],
      }),
      new AIMessage({ content: "Thanks Sam, the team will get back to you." }),
    ]);
    const result = await runAgentTurn(model, context, [{ role: "user", content: "Can someone call me about balayage? I'm Sam, 604 555 0101" }]);
    expect(result.leads).toHaveLength(1);
    expect(result.leads[0]).toMatchObject({ name: "Sam", phone: "604 555 0101", interest: "Balayage quote" });
    expect(result.activity.some((a) => a.label === "Saved a lead")).toBe(true);
  });

  it("only offers lead capture when the skill is on", () => {
    const on = buildSystemPrompt(context);
    expect(on).toContain("call capture_lead");
    const off = buildAgentContext(sampleAssistantIdentity, createKnowledgeStoreFromBusiness(sampleBusiness), new Date(), {
      ...context.skills,
      leads: "off",
    });
    expect(buildSystemPrompt(off)).not.toContain("capture_lead");
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
    expect(ready.ready && ready.config.models.fast).toBe("gpt-4o-mini");
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
    const names = buildTools(off, { approvals: [], handoffs: [], leads: [] }).map((t) => t.name);
    expect(names).toEqual(["search_knowledge", "get_business_details"]);
    expect(buildSystemPrompt(off)).toContain("You cannot take bookings");
    const on = buildTools(context, { approvals: [], handoffs: [], leads: [] }).map((t) => t.name);
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

/**
 * The prompt names the booking tool, and which tool exists depends on what is
 * connected. Naming one the model has not been given is worse than naming
 * none: it follows the rule, finds no such tool, and falls back to "I don't
 * have an approved answer for that" — which is what a real conversation did.
 */
describe("the booking rule matches the tools on offer", () => {
  const withCalendar = new Set<IntegrationId>(["google_calendar"]);
  const contextWithBooking = (booking: "ask" | "off") =>
    buildAgentContext(
      sampleAssistantIdentity,
      createKnowledgeStoreFromBusiness(sampleBusiness),
      new Date(),
      { answer: "auto", booking, handoff: "auto", leads: "auto" },
    );
  const rule3 = (prompt: string) =>
    prompt.split("\n").find((line) => line.startsWith("3.")) ?? "";

  it("names the calendar tools when a calendar is connected", () => {
    const prompt = buildSystemPrompt(contextWithBooking("ask"), withCalendar);
    expect(rule3(prompt)).toContain("check_availability");
    expect(rule3(prompt)).toContain("propose_booking");
  });

  it("never names request_booking when it is not offered", () => {
    // availableContracts withholds it once propose_booking is available, so
    // naming it here would point the model at a tool it does not have.
    const prompt = buildSystemPrompt(contextWithBooking("ask"), withCalendar);
    expect(prompt).not.toContain("request_booking");
  });

  it("tells the model to check before answering, not after", () => {
    const prompt = buildSystemPrompt(contextWithBooking("ask"), withCalendar);
    expect(rule3(prompt)).toMatch(/first/i);
    expect(rule3(prompt)).toMatch(/first message/i);
  });

  it("forbids offering a time it worked out itself", () => {
    const prompt = buildSystemPrompt(contextWithBooking("ask"), withCalendar);
    expect(rule3(prompt)).toMatch(/only the times it returns/i);
  });

  it("keeps the generic tool when there is no calendar", () => {
    const prompt = buildSystemPrompt(contextWithBooking("ask"));
    expect(rule3(prompt)).toContain("request_booking");
    expect(rule3(prompt)).not.toContain("check_availability");
  });

  it("says bookings are off whatever is connected", () => {
    for (const connected of [undefined, withCalendar])
      expect(rule3(buildSystemPrompt(contextWithBooking("off"), connected))).toContain(
        "You cannot take bookings",
      );
  });

  it("never claims a booking is confirmed", () => {
    for (const connected of [undefined, withCalendar])
      expect(rule3(buildSystemPrompt(contextWithBooking("ask"), connected))).toMatch(
        /never say it is confirmed/i,
      );
  });
});

/**
 * When a tool call is rejected the model gets one chance to correct it, and
 * it can only do that if it is told what was wrong. A real conversation lost
 * a booking here: propose_booking was rejected, the model was told only
 * "The tool rejected those arguments", and it never recovered.
 */
describe("a rejected tool call", () => {
  it("tells the model which argument was wrong", async () => {
    const { model, seen } = scriptedModel([
      new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "call_1",
            name: "search_knowledge",
            // query is required; omitting it is what a confused model does.
            args: {},
          },
        ],
      }),
      new AIMessage({ content: "Sorry, let me try that again." }),
    ]);
    await runAgentTurn(model, context, [
      { role: "user", content: "Is there parking?" },
    ]);

    const toolReply = seen[1]
      .map((message) => String(message.content))
      .find((text) => text.includes("rejected those arguments"));
    expect(toolReply).toBeTruthy();
    // The name of the offending argument has to survive to the model.
    expect(toolReply).toMatch(/query/i);
    expect(toolReply).toMatch(/call it again/i);
  });

  it("records the reason for the owner, not just that it failed", async () => {
    const { model } = scriptedModel([
      new AIMessage({
        content: "",
        tool_calls: [{ id: "call_1", name: "search_knowledge", args: {} }],
      }),
      new AIMessage({ content: "Sorry about that." }),
    ]);
    const result = await runAgentTurn(model, context, [
      { role: "user", content: "Is there parking?" },
    ]);

    const failure = result.activity.find((entry) => entry.kind === "error");
    expect(failure).toBeTruthy();
    expect(failure!.detail).not.toBe("Arguments did not pass validation.");
    expect(failure!.detail).toMatch(/query/i);
  });
});

/**
 * A tool allowed to ask for approval does not always end up asking: the slot
 * may have gone, or a time may already be waiting. The trace was labelled
 * from the contract's declared effect, so a refused booking still read
 * "Waiting for your approval. Nothing was booked" — the owner saw a pending
 * request that did not exist anywhere.
 */
describe("what the trace says about an approval", () => {
  const bookingCall = (args: Record<string, unknown>) =>
    new AIMessage({
      content: "",
      tool_calls: [{ id: "call_1", name: "request_booking", args }],
    });

  it("says it is waiting when something really is", async () => {
    const { model } = scriptedModel([
      bookingCall({ service: "Haircut", preferredTime: "Tuesday" }),
      new AIMessage({ content: "Sent to the business." }),
    ]);
    const result = await runAgentTurn(model, context, [
      { role: "user", content: "Book me in" },
    ]);

    expect(result.approvals).toHaveLength(1);
    const entry = result.activity.find((a) => a.kind === "approval");
    expect(entry?.detail).toMatch(/waiting for your approval/i);
  });

  it("does not claim a request is waiting when the tool refused", async () => {
    // Three booking calls in one turn: the tool takes two and refuses the
    // third, which must not be traced as something the owner can decide.
    const { model } = scriptedModel([
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "a", name: "request_booking", args: { service: "Cut" } },
          { id: "b", name: "request_booking", args: { service: "Colour" } },
          { id: "c", name: "request_booking", args: { service: "Perm" } },
        ],
      }),
      new AIMessage({ content: "Done." }),
    ]);
    const result = await runAgentTurn(model, context, [
      { role: "user", content: "Book me in" },
    ]);

    // Only what was really recorded may be traced as awaiting approval.
    const waiting = result.activity.filter((a) => a.kind === "approval");
    expect(waiting).toHaveLength(result.approvals.length);
    expect(result.approvals.length).toBeLessThan(3);

    const refused = result.activity.filter(
      (a) => a.detail === "Nothing was sent for your approval.",
    );
    expect(refused.length).toBeGreaterThan(0);
    for (const entry of refused) expect(entry.kind).not.toBe("approval");
  });
});

describe("the cancellation rule", () => {
  const withCalendar = new Set<IntegrationId>(["google_calendar"]);
  const rule3 = (prompt: string) =>
    prompt.split("\n").find((line) => line.startsWith("3.")) ?? "";
  const bookingContext = (booking: "ask" | "off") =>
    buildAgentContext(
      sampleAssistantIdentity,
      createKnowledgeStoreFromBusiness(sampleBusiness),
      new Date(),
      { answer: "auto", booking, handoff: "auto", leads: "auto" },
    );

  it("names the cancel tool when a calendar is connected", () => {
    expect(rule3(buildSystemPrompt(bookingContext("ask"), withCalendar))).toContain(
      "cancel_booking",
    );
  });

  it("forbids cancelling or moving anything the customer does not have", () => {
    // The crew must not go hunting through the calendar for a near match.
    const rule = rule3(buildSystemPrompt(bookingContext("ask"), withCalendar));
    expect(rule).toMatch(/no appointments listed/i);
    expect(rule).toMatch(/rather than cancelling or moving anything/i);
  });

  it("names the reschedule tool and how to reach a time for it", () => {
    const rule = rule3(buildSystemPrompt(bookingContext("ask"), withCalendar));
    expect(rule).toContain("reschedule_booking");
    // A move needs a real free time, same as a booking does.
    expect(rule).toMatch(/check_availability and then reschedule_booking/i);
  });

  it("never names a cancel tool the model was not given", () => {
    // Without a calendar there is nothing to cancel through us.
    expect(buildSystemPrompt(bookingContext("ask"))).not.toContain(
      "cancel_booking",
    );
    expect(buildSystemPrompt(bookingContext("off"), withCalendar)).not.toContain(
      "cancel_booking",
    );
  });
});
