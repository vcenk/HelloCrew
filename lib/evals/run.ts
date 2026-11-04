import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { buildAgentContext } from "@/lib/agent/context";
import { runAgentTurn } from "@/lib/agent/graph";
import { sampleAssistantIdentity } from "@/lib/assistant";
import { sampleBusiness } from "@/lib/business";
import { createKnowledgeStoreFromBusiness } from "@/lib/knowledge";
import { grade, type Answer, type Failure } from "./grade";
import type { Scenario } from "./scenarios";

/**
 * Runs the corpus through the real agent graph.
 *
 * The graph is the thing under test, not a copy of it: the same prompt, the
 * same tool contracts, the same rounds limit. Only the model is swapped, so
 * CI can run this with a scripted one and a person can run it against the
 * real model when they want to know how it actually behaves.
 */

export type ScenarioResult = {
  scenario: Scenario;
  answer: Answer;
  failures: Failure[];
  /** Set when the turn threw rather than answering. */
  error?: string;
};

export function evalContext(now = new Date("2026-11-04T12:00:00Z")) {
  return buildAgentContext(
    sampleAssistantIdentity,
    createKnowledgeStoreFromBusiness(sampleBusiness),
    now,
  );
}

export async function runScenario(
  model: BaseChatModel,
  scenario: Scenario,
  context = evalContext(),
): Promise<ScenarioResult> {
  // Earlier turns are context; the last one is the one being graded.
  const history = scenario.say.slice(0, -1).flatMap((text) => [
    { role: "user" as const, content: text },
    { role: "assistant" as const, content: "…" },
  ]);
  const asked = scenario.say[scenario.say.length - 1];

  try {
    const result = await runAgentTurn(model, context, [
      ...history,
      { role: "user", content: asked },
    ]);
    const answer: Answer = {
      reply: result.reply,
      toolCalls: result.activity
        .map((entry) => entry.tool)
        .filter((tool): tool is string => Boolean(tool)),
      unanswered: result.unanswered,
    };
    return { scenario, answer, failures: grade(answer, scenario.checks) };
  } catch (error) {
    const answer: Answer = { reply: "", toolCalls: [] };
    return {
      scenario,
      answer,
      failures: [{ why: "the turn did not complete", detail: "see error" }],
      error: error instanceof Error ? error.message : "unknown",
    };
  }
}

export type Report = {
  results: ScenarioResult[];
  passed: number;
  failed: number;
};

export function summarize(results: ScenarioResult[]): Report {
  const failed = results.filter((result) => result.failures.length > 0).length;
  return { results, passed: results.length - failed, failed };
}

/** The report a person reads in a terminal. */
export function formatReport(report: Report): string {
  const lines: string[] = [];
  for (const result of report.results) {
    const ok = result.failures.length === 0;
    lines.push(`${ok ? "pass" : "FAIL"}  ${result.scenario.id}  — ${result.scenario.about}`);
    if (!ok) {
      if (result.error) lines.push(`        error: ${result.error}`);
      for (const failure of result.failures)
        lines.push(`        ${failure.why}`);
      for (const failure of result.failures)
        lines.push(`          (${failure.detail})`);
      lines.push(`        reply: ${JSON.stringify(result.answer.reply.slice(0, 300))}`);
    }
  }
  lines.push("");
  lines.push(`${report.passed} passed, ${report.failed} failed, ${report.results.length} total`);
  return lines.join("\n");
}
