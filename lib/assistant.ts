import { z } from "zod";

export const assistantTones = [
  "Warm and concise",
  "Professional and clear",
  "Friendly and conversational",
] as const;

export const assistantIdentitySchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    role: z.string().trim().min(1).max(180),
    greeting: z.string().trim().min(1).max(240),
    tone: z.enum(assistantTones),
    fallback: z.string().trim().min(1).max(280),
  })
  .strict();

export type AssistantIdentity = z.infer<typeof assistantIdentitySchema>;

export const sampleAssistantIdentity: AssistantIdentity = {
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
