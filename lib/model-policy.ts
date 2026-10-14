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
    status: "not-connected",
    description:
      "A future server-side adapter can use an approved OpenAI model profile.",
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

export const activeModelPolicy = {
  primary: "practice" as ModelProviderId,
  fallbacks: [] as ModelProviderId[],
  managedOnServer: true,
};
