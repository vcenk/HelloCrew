import "server-only";

import { ChatOpenAI } from "@langchain/openai";

import type { LiveConfig } from "@/lib/server/live-config";

// The one place HelloCrew constructs an OpenAI client. Channels and workflows
// never pick a provider or model; they call the agent runtime.
export function createOpenAIChatModel(config: LiveConfig) {
  return new ChatOpenAI({
    model: config.model,
    apiKey: config.openaiApiKey,
    maxTokens: config.maxOutputTokens,
    timeout: 25_000,
    maxRetries: 1,
    reasoning: { effort: "low" },
  });
}
