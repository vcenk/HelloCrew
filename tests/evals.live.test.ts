import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readFileSync } from "node:fs";
import { describe, expect, it, beforeAll } from "vitest";

import { createOpenAIChatModel } from "../lib/models/openai";
import { formatReport, runScenario, summarize } from "../lib/evals/run";
import { scenarios } from "../lib/evals/scenarios";
import { readLiveConfig } from "../lib/server/live-config";
import { modelFor } from "../lib/server/model-router";
import type { ScenarioResult } from "../lib/evals/run";

/**
 * The corpus against the real model.
 *
 *   npm run eval
 *
 * Skipped everywhere else, including `npm test` and CI, because it costs
 * money on every run and depends on a third party being up — neither of
 * which belongs in a suite people run on every commit. The harness itself is
 * covered in evals.test.ts without a model.
 *
 * Run it before and after changing the system prompt, a tool contract, or
 * the knowledge pipeline. A failure here is a behaviour change, which is not
 * the same as a bug: read the reply it prints and decide.
 */

// npm sets this to the script name on every platform, so `npm run eval`
// works the same in bash and on Windows without a cross-env dependency.
const REQUESTED =
  process.env.npm_lifecycle_event === "eval" || process.env.EVAL_LIVE === "1";

/** .env.local is Next's, not Vitest's, so the key is read directly. */
function loadLocalEnv() {
  let text: string;
  try {
    text = readFileSync(".env.local", "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key]) continue;
    process.env[key] = raw.trim().replace(/^["']|["']$/g, "");
  }
}

describe.skipIf(!REQUESTED)("the receptionist, against the real model", () => {
  const results: ScenarioResult[] = [];

  beforeAll(async () => {
    loadLocalEnv();
    const live = readLiveConfig();
    if (!live.ready)
      throw new Error(
        "No OpenAI key. Set OPENAI_API_KEY in .env.local — these evals call the real model.",
      );

    const model = createOpenAIChatModel(live.config, {
      model: modelFor(live.config, "converse"),
    });
    // One at a time. The corpus is small, and a rate-limit error in the
    // middle of a parallel run reads as a behaviour failure, which is a
    // worse outcome than taking a minute.
    for (const scenario of scenarios)
      results.push(await runScenario(model, scenario));

    // Written straight to stdout: Vitest buffers console output per test and
    // prints it only when that test fails, and the report is most useful on
    // the runs that pass — that is where you see what the model actually
    // said before deciding whether a prompt change was an improvement.
    process.stdout.write("\n" + formatReport(summarize(results)) + "\n\n");
  }, 300_000);

  it("answers every scenario the way the corpus requires", () => {
    const failed = results.filter((result) => result.failures.length > 0);
    expect(
      failed.map((result) => result.scenario.id),
      "see the report above for each reply",
    ).toEqual([]);
  });
});
