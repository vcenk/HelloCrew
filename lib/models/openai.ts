import "server-only";

import { ChatOpenAI } from "@langchain/openai";

import type { LiveConfig } from "@/lib/server/live-config";

// The one place HelloCrew constructs an OpenAI client. Channels and workflows
// never pick a provider or model; they call the agent runtime.
export function createOpenAIChatModel(
  config: LiveConfig,
  options: { maxTokens?: number; timeoutMs?: number; model?: string } = {},
) {
  return new ChatOpenAI({
    // The router picks the model; this is only the fallback for callers that
    // have not been given a task yet.
    model: options.model ?? config.models.fast,
    apiKey: config.openaiApiKey,
    maxTokens: options.maxTokens ?? config.maxOutputTokens,
    timeout: options.timeoutMs ?? 25_000,
    maxRetries: 1,
    reasoning: { effort: "low" },
    // Required, not a preference. The gpt-6 family only exposes function
    // calling on Chat Completions when reasoning effort is "none", and every
    // caller here binds tools — the agent books appointments, the Copilot
    // edits the workspace. The Responses API carries reasoning and tools
    // together, so the effort above keeps working.
    useResponsesApi: true,
  });
}
