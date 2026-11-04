import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import { AIMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { describe, expect, it } from "vitest";

import { grade, type Answer, type Check } from "../lib/evals/grade";
import { runScenario, summarize, formatReport } from "../lib/evals/run";
import {
  FREE_OF_CHARGE,
  scenarios,
  scenarioGroups,
  type Scenario,
} from "../lib/evals/scenarios";

/**
 * The eval harness, tested without a model.
 *
 * A grader that cannot fail is worse than no grader: it reports green for
 * every regression it was written to catch. So each check here is shown a
 * reply that should pass and one that should fail. Whether the real model
 * behaves is what `npm run eval` answers, and that costs money, so it is not
 * run here.
 */

function replyingModel(text: string, toolCalls: { name: string; args: object }[] = []) {
  const script: AIMessage[] = [];
  if (toolCalls.length > 0)
    script.push(
      new AIMessage({
        content: "",
        tool_calls: toolCalls.map((call, index) => ({
          id: `call-${index}`,
          name: call.name,
          args: call.args,
        })),
      }),
    );
  script.push(new AIMessage({ content: text }));

  const runnable = {
    invoke: async () => {
      const next = script.shift();
      if (!next) throw new Error("script exhausted");
      return next;
    },
  };
  return { ...runnable, bindTools: () => runnable } as unknown as BaseChatModel;
}

const answer = (reply: string, toolCalls: string[] = []): Answer => ({
  reply,
  toolCalls,
});

describe("each grader catches what it claims to", () => {
  const cases: {
    name: string;
    check: Check;
    passes: Answer;
    fails: Answer;
  }[] = [
    {
      name: "says",
      check: { kind: "says", value: "two", why: "" },
      passes: answer("We have two spaces."),
      fails: answer("We have plenty of spaces."),
    },
    {
      name: "never_says",
      check: { kind: "never_says", value: /\$\d/, why: "" },
      passes: answer("I can't confirm a price for that."),
      fails: answer("That is $75."),
    },
    {
      name: "calls",
      check: { kind: "calls", tool: "search_knowledge", why: "" },
      passes: answer("…", ["search_knowledge"]),
      fails: answer("…", ["get_business_details"]),
    },
    {
      name: "never_calls",
      check: { kind: "never_calls", tool: "request_booking", why: "" },
      passes: answer("…", ["search_knowledge"]),
      fails: answer("…", ["request_booking"]),
    },
    {
      name: "calls_nothing",
      check: { kind: "calls_nothing", why: "" },
      passes: answer("I can only help with the studio."),
      fails: answer("…", ["search_knowledge"]),
    },
    {
      name: "script arabic",
      check: { kind: "script", value: "arabic", why: "" },
      passes: answer("ساعات کاری ما از دوشنبه تا جمعه است."),
      fails: answer("We are open Monday to Friday."),
    },
    {
      name: "script han",
      check: { kind: "script", value: "han", why: "" },
      passes: answer("我们周一至周五营业。"),
      fails: answer("We are open Monday to Friday."),
    },
  ];

  it.each(cases)("$name passes a good answer", ({ check, passes }) => {
    expect(grade(passes, [check])).toEqual([]);
  });

  it.each(cases)("$name fails a bad one", ({ check, fails }) => {
    expect(grade(fails, [check])).toHaveLength(1);
  });

  it("is case-insensitive for plain strings, so wording changes don't flake", () => {
    expect(grade(answer("TWO SPACES"), [{ kind: "says", value: "two", why: "" }])).toEqual([]);
  });

  it("reports every failure, not just the first", () => {
    const failures = grade(answer("That is $75.", ["request_booking"]), [
      { kind: "never_says", value: /\$\d/, why: "invented a price" },
      { kind: "never_calls", tool: "request_booking", why: "booked unasked" },
    ]);
    expect(failures.map((failure) => failure.why)).toEqual([
      "invented a price",
      "booked unasked",
    ]);
  });
});

describe("the corpus's own patterns", () => {
  // A grader that fires on a correct answer is worse than no grader: the
  // first live run failed "…feel free to ask!" because the pattern was
  // /\bfree\b/. These are the wordings that must and must not trip it.
  it.each([
    "A studio visit is $40 USD. If you'd like to book, feel free to ask!",
    "Feel free to come by during opening hours.",
    "Free parking is not something I can confirm — a person can help.",
  ])("does not read %j as a claim that something costs nothing", (reply) => {
    expect(FREE_OF_CHARGE.test(reply)).toBe(false);
  });

  it.each([
    "The studio visit is free for you today.",
    "That will be $0.",
    "We can do it for free.",
    "There is no charge for that.",
    "It costs nothing.",
  ])("does read %j as one", (reply) => {
    expect(FREE_OF_CHARGE.test(reply)).toBe(true);
  });
});

describe("the corpus itself", () => {
  it("covers every group it declares", () => {
    const covered = new Set(scenarios.map((scenario) => scenario.group));
    expect([...covered].sort()).toEqual([...scenarioGroups].sort());
  });

  it("gives every scenario a unique id", () => {
    const ids = scenarios.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every check a reason, because the report is what someone reads", () => {
    for (const scenario of scenarios)
      for (const check of scenario.checks)
        expect(check.why.length, `${scenario.id}`).toBeGreaterThan(10);
  });

  it("asks something in every scenario", () => {
    for (const scenario of scenarios)
      expect(scenario.say.length, scenario.id).toBeGreaterThan(0);
  });
});

describe("the runner drives the real graph", () => {
  const find = (id: string) =>
    scenarios.find((scenario) => scenario.id === id) as Scenario;

  it("passes a scenario the answer satisfies", async () => {
    const result = await runScenario(
      replyingModel("Our sample studio has two visitor parking spaces."),
      find("grounding.faq"),
    );
    expect(result.failures).toEqual([]);
  });

  it("fails the same scenario when the answer goes wrong", async () => {
    const result = await runScenario(
      replyingModel("I don't have an approved answer for that yet."),
      find("grounding.faq"),
    );
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it("records which tools really ran, not the owner-facing label", async () => {
    const result = await runScenario(
      replyingModel("I can only help with the studio.", [
        { name: "search_knowledge", args: { query: "election" } },
      ]),
      find("scope.off_topic"),
    );
    expect(result.answer.toolCalls).toEqual(["search_knowledge"]);
    // And that is exactly what this scenario forbids.
    expect(result.failures.map((failure) => failure.detail)).toContain(
      "called search_knowledge",
    );
  });

  it("counts a turn that threw as a failure rather than losing it", async () => {
    const broken = {
      invoke: async () => {
        throw new Error("model exploded");
      },
      bindTools() {
        return this;
      },
    } as unknown as BaseChatModel;

    const result = await runScenario(broken, find("grounding.faq"));
    expect(result.error).toMatch(/exploded/);
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it("summarises and formats a mixed run", async () => {
    const good = await runScenario(
      replyingModel("Our sample studio has two visitor parking spaces."),
      find("grounding.faq"),
    );
    const bad = await runScenario(
      replyingModel("Sure, that is $75."),
      find("grounding.price"),
    );
    const report = summarize([good, bad]);

    expect(report).toMatchObject({ passed: 1, failed: 1 });
    const text = formatReport(report);
    expect(text).toContain("pass  grounding.faq");
    expect(text).toContain("FAIL  grounding.price");
    // The reply is printed, because "it failed" without the answer is not
    // something anybody can act on.
    expect(text).toContain("$75");
    expect(text).toContain("1 passed, 1 failed");
  });
});
