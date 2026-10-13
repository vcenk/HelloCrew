import { z } from "zod";

export const assistantTones = [
  "Warm and concise",
  "Professional and clear",
  "Friendly and conversational",
] as const;

export const assistantPurposes = [
  "customer-support",
  "receptionist",
  "booking",
  "sales",
  "custom",
] as const;

export type AssistantPurpose = (typeof assistantPurposes)[number];

export const assistantIdentitySchema = z
  .object({
    purpose: z.enum(assistantPurposes).default("receptionist"),
    name: z.string().trim().min(1).max(60),
    role: z.string().trim().min(1).max(180),
    greeting: z.string().trim().min(1).max(240),
    tone: z.enum(assistantTones),
    fallback: z.string().trim().min(1).max(280),
  })
  .strict();

export type AssistantIdentity = z.infer<typeof assistantIdentitySchema>;

export type AssistantPurposePreset = AssistantIdentity & {
  label: string;
  summary: string;
  features: readonly string[];
};

export const assistantPurposePresets: readonly AssistantPurposePreset[] = [
  {
    purpose: "customer-support",
    label: "Customer support",
    summary:
      "Resolve common questions and guide people when something is unclear.",
    name: "Support guide",
    role: "Answer approved customer questions and guide people to the right next step.",
    greeting: "Hello! How can I help you today?",
    tone: "Warm and concise",
    fallback:
      "I don’t have an approved answer for that yet. A person can help confirm it.",
    features: [
      "Approved FAQ answers",
      "Policy guidance",
      "Human handoff prompt",
    ],
  },
  {
    purpose: "receptionist",
    label: "Receptionist",
    summary: "Welcome visitors and help them understand the business.",
    name: "Studio guide",
    role: "Help visitors understand the business and find the right next step.",
    greeting: "Hello! What can I help you find today?",
    tone: "Warm and concise",
    fallback:
      "I don’t have an approved answer for that yet. A person can help confirm it.",
    features: [
      "Welcome visitors",
      "Share hours and services",
      "Direct the next step",
    ],
  },
  {
    purpose: "booking",
    label: "Booking assistant",
    summary: "Answer service questions and guide visitors toward booking.",
    name: "Booking guide",
    role: "Explain approved services and help visitors reach the booking page.",
    greeting:
      "Hello! I can help you find the right service and booking option.",
    tone: "Friendly and conversational",
    fallback:
      "I’m not certain from the approved information. A person can help before you book.",
    features: [
      "Explain services",
      "Share the booking link",
      "Escalate special requests",
    ],
  },
  {
    purpose: "sales",
    label: "Sales assistant",
    summary:
      "Explain the offer and help interested visitors choose a next step.",
    name: "Product guide",
    role: "Explain approved offers and help interested visitors choose the right next step.",
    greeting:
      "Hello! Tell me what you’re looking for and I’ll point you in the right direction.",
    tone: "Professional and clear",
    fallback:
      "I don’t have enough approved information to answer that accurately. A person can follow up.",
    features: [
      "Explain approved offers",
      "Understand visitor interest",
      "Suggest a next step",
    ],
  },
  {
    purpose: "custom",
    label: "Custom purpose",
    summary: "Start with a safe general assistant and shape it yourself.",
    name: "Business guide",
    role: "Help visitors using only approved business information.",
    greeting: "Hello! How can I help?",
    tone: "Warm and concise",
    fallback:
      "I don’t have an approved answer for that yet. A person can help confirm it.",
    features: [
      "Approved knowledge only",
      "Editable role and greeting",
      "Safe unknown-answer fallback",
    ],
  },
] as const;

export function identityForPurpose(
  purpose: AssistantPurpose,
): AssistantIdentity {
  const preset = assistantPurposePresets.find(
    (candidate) => candidate.purpose === purpose,
  );
  if (!preset) return sampleAssistantIdentity;
  return {
    purpose: preset.purpose,
    name: preset.name,
    role: preset.role,
    greeting: preset.greeting,
    tone: preset.tone,
    fallback: preset.fallback,
  };
}

export const sampleAssistantIdentity: AssistantIdentity = {
  purpose: "receptionist",
  name: "Studio guide",
  role: "Help visitors understand the studio and find the right next step.",
  greeting: "Hello! What can I help you find today?",
  tone: "Warm and concise",
  fallback:
    "I don’t have an approved answer for that yet. A person can help confirm it.",
};

export function parseAssistantIdentity(input: unknown) {
  return assistantIdentitySchema.safeParse(input);
}
