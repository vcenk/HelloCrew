import { describe, expect, it, vi } from "vitest";

import { readLiveConfig } from "../lib/server/live-config";
import {
  modelChain,
  modelFor,
  withModelFallback,
} from "../lib/server/model-router";

function config(env: Record<string, string> = {}) {
  const live = readLiveConfig({
    OPENAI_API_KEY: "k",
    SUPABASE_SECRET_KEY: "s",
    ...env,
  });
  if (!live.ready) throw new Error("expected a ready config");
  return live.config;
}

describe("model configuration", () => {
  it("falls back to one model when only OPENAI_MODEL is set", () => {
    const c = config({ OPENAI_MODEL: "gpt-solo" });
    expect(c.models).toEqual({ fast: "gpt-solo", strong: "gpt-solo" });
    // Nothing to retry against when both are the same model.
    expect(modelChain(c, "converse")).toEqual(["gpt-solo"]);
  });

  it("reads a separate fast and strong model", () => {
    const c = config({
      OPENAI_MODEL_FAST: "gpt-fast",
      OPENAI_MODEL_STRONG: "gpt-strong",
    });
    expect(c.models).toEqual({ fast: "gpt-fast", strong: "gpt-strong" });
  });
});

describe("routing by task", () => {
  const c = () =>
    config({ OPENAI_MODEL_FAST: "fast", OPENAI_MODEL_STRONG: "strong" });

  it("sends a live conversation to the strong model", () => {
    expect(modelFor(c(), "converse")).toBe("strong");
  });

  it("sends short, well-defined jobs to the fast model", () => {
    for (const task of ["classify", "extract", "draft"] as const)
      expect(modelFor(c(), task), task).toBe("fast");
  });

  it("orders the fallback chain behind the first choice", () => {
    expect(modelChain(c(), "converse")).toEqual(["strong", "fast"]);
    expect(modelChain(c(), "classify")).toEqual(["fast", "strong"]);
  });
});

describe("provider failure", () => {
  const c = () =>
    config({ OPENAI_MODEL_FAST: "fast", OPENAI_MODEL_STRONG: "strong" });

  it("reports the model that answered and does not mark a fallback", async () => {
    const attempt = vi.fn(async (model: string) => `ok:${model}`);
    const result = await withModelFallback(c(), "converse", attempt);
    expect(result.value).toBe("ok:strong");
    expect(result.model).toBe("strong");
    expect(result.fellBack).toBe(false);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("falls back to the next model and says so", async () => {
    const attempt = vi.fn(async (model: string) => {
      if (model === "strong") throw new Error("provider down");
      return `ok:${model}`;
    });
    const result = await withModelFallback(c(), "converse", attempt);
    expect(result.value).toBe("ok:fast");
    // The run records what actually answered, not what was intended.
    expect(result.model).toBe("fast");
    expect(result.fellBack).toBe(true);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("raises the provider's own error when every model fails", async () => {
    const attempt = vi.fn(async () => {
      throw new Error("provider down");
    });
    await expect(
      withModelFallback(c(), "converse", attempt),
    ).rejects.toThrow(/provider down/);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("does not retry the same model twice", async () => {
    const single = config({ OPENAI_MODEL: "only" });
    const attempt = vi.fn(async () => {
      throw new Error("provider down");
    });
    await expect(withModelFallback(single, "converse", attempt)).rejects.toThrow();
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
