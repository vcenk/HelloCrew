/**
 * How an answer is judged.
 *
 * Deterministic on purpose. Asking a model whether another model behaved is
 * cheap to write and hard to trust: the judge fabricates too, it costs money
 * on every run, and a flaky judge turns a regression net into noise nobody
 * reads. Everything here is a string or a tool name, so a failure points at
 * one concrete thing that changed.
 */

export type Answer = {
  /** What the customer would see. */
  reply: string;
  /** Tools the agent actually called, in order. */
  toolCalls: string[];
  /** True when the agent reported it had no approved answer. */
  unanswered?: boolean;
};

export type Check =
  /** The reply has to contain this, case-insensitively. */
  | { kind: "says"; value: string | RegExp; why: string }
  /** The reply must not contain it. The fabrication checks live here. */
  | { kind: "never_says"; value: string | RegExp; why: string }
  | { kind: "calls"; tool: string; why: string }
  | { kind: "never_calls"; tool: string; why: string }
  /** No tool at all — for off-topic, where even searching is wrong. */
  | { kind: "calls_nothing"; why: string }
  /** The reply is written in this script, for the multilingual checks. */
  | { kind: "script"; value: "latin" | "arabic" | "han"; why: string };

export type Failure = { why: string; detail: string };

const SCRIPTS: Record<"latin" | "arabic" | "han", RegExp> = {
  latin: /[A-Za-z]/,
  // Persian and Arabic share the block; the corpus only asks for the script.
  arabic: /[؀-ۿ]/,
  han: /[一-鿿]/,
};

function matches(haystack: string, needle: string | RegExp) {
  return typeof needle === "string"
    ? haystack.toLowerCase().includes(needle.toLowerCase())
    : needle.test(haystack);
}

const show = (value: string | RegExp) =>
  typeof value === "string" ? `“${value}”` : String(value);

/** Every check that did not hold, with enough detail to act on. */
export function grade(answer: Answer, checks: readonly Check[]): Failure[] {
  const failures: Failure[] = [];
  for (const check of checks) {
    switch (check.kind) {
      case "says":
        if (!matches(answer.reply, check.value))
          failures.push({
            why: check.why,
            detail: `expected the reply to contain ${show(check.value)}`,
          });
        break;
      case "never_says":
        if (matches(answer.reply, check.value))
          failures.push({
            why: check.why,
            detail: `the reply contains ${show(check.value)}`,
          });
        break;
      case "calls":
        if (!answer.toolCalls.includes(check.tool))
          failures.push({
            why: check.why,
            detail: `${check.tool} was not called (called: ${answer.toolCalls.join(", ") || "nothing"})`,
          });
        break;
      case "never_calls":
        if (answer.toolCalls.includes(check.tool))
          failures.push({ why: check.why, detail: `${check.tool} was called` });
        break;
      case "calls_nothing":
        if (answer.toolCalls.length > 0)
          failures.push({
            why: check.why,
            detail: `called ${answer.toolCalls.join(", ")}`,
          });
        break;
      case "script":
        if (!SCRIPTS[check.value].test(answer.reply))
          failures.push({
            why: check.why,
            detail: `the reply is not written in ${check.value} script`,
          });
        break;
    }
  }
  return failures;
}
