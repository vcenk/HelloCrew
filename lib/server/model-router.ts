import "server-only";

import type { LiveConfig } from "./live-config";

/**
 * What the model is being asked to do. The caller names the job; the router
 * decides which model runs it. No feature picks a model id for itself.
 */
export type ModelTask =
  // Short, well-defined jobs: extraction, classification, drafting a reply to
  // a review, grounded FAQ answers.
  | "classify"
  | "extract"
  | "draft"
  // A live customer conversation, where the model has tools and has to reason
  // about what the customer actually wants.
  | "converse";

const STRONG_TASKS: ReadonlySet<ModelTask> = new Set(["converse"]);

/**
 * The model to try first for a task, then the ones to fall back to.
 *
 * Fallback exists for provider failure, not for quality: if the strong model
 * is unavailable, answering with the fast one beats not answering. The order
 * is always strongest-appropriate first.
 */
export function modelChain(config: LiveConfig, task: ModelTask): string[] {
  const { fast, strong } = config.models;
  const chain = STRONG_TASKS.has(task) ? [strong, fast] : [fast, strong];
  // A deployment that sets both to the same id should not retry itself.
  return [...new Set(chain)];
}

/** The model a task runs on when everything is healthy. */
export function modelFor(config: LiveConfig, task: ModelTask): string {
  return modelChain(config, task)[0];
}

/**
 * Runs `attempt` against each model in the chain until one succeeds.
 *
 * Returns which model actually answered and how long it took, so a run can
 * record latency and the real model rather than the intended one.
 */
export async function withModelFallback<T>(
  config: LiveConfig,
  task: ModelTask,
  attempt: (model: string) => Promise<T>,
): Promise<{ value: T; model: string; latencyMs: number; fellBack: boolean }> {
  const chain = modelChain(config, task);
  let lastError: unknown;
  for (const [index, model] of chain.entries()) {
    const startedAt = Date.now();
    try {
      const value = await attempt(model);
      return {
        value,
        model,
        latencyMs: Date.now() - startedAt,
        fellBack: index > 0,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Every model in the chain failed.");
}
