export const modelProviders = [
  {
    id: "practice",
    label: "Practice engine",
    product: "Deterministic local responses",
    status: "active",
    description:
      "Uses approved fictional facts without an external AI model or paid call.",
  },
  {
    id: "openai",
    label: "OpenAI",
    product: "GPT models",
    status: "active",
    description:
      "Used for Live AI. Model ids, routing and budgets are server-side; see lib/server/model-router.ts.",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    product: "Claude models",
    status: "not-connected",
    description:
      "A future server-side adapter can use an approved Claude model profile.",
  },
] as const;

export type ModelProviderId = (typeof modelProviders)[number]["id"];

// Practice is what a signed-out visitor gets; Live AI falls back to it when
// a workspace has no budget left or no provider configured.
export const activeModelPolicy = {
  primary: "openai" as ModelProviderId,
  fallbacks: ["practice"] as ModelProviderId[],
  managedOnServer: true,
};
