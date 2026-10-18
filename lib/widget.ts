import { z } from "zod";

import { identityForPurpose, type AssistantIdentity } from "./assistant";
import {
  messageSchema,
  sampleBusiness,
  type BusinessProfile,
} from "./business";
import type { ModelProviderId } from "./model-policy";

export const DEMO_WIDGET_INSTALLATION_ID = "demo-hellocrew";

export const widgetInstallationIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{2,63}$/);

export const widgetMessageRequestSchema = z
  .object({
    installationId: widgetInstallationIdSchema,
    message: messageSchema,
  })
  .strict();

export const PUBLIC_WIDGET_ID = /^w-[a-z0-9]{20}$/;

// A website the owner allows to embed their chat: scheme + host (+ port).
// http is accepted only for local testing.
export function normalizeOrigin(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`);
    const local = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
    if (url.username || url.password) return null;
    if (!/^[a-z0-9.-]+$/i.test(url.hostname) || !url.hostname.includes(".") && !local) return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

export const widgetChatRequestSchema = z
  .object({
    installationId: z.string().regex(PUBLIC_WIDGET_ID),
    conversation: z
      .object({ id: z.string().uuid(), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
      .strict()
      .optional(),
    message: z.string().trim().min(1).max(1000),
  })
  .strict();

export type WidgetChatMessage = {
  id: string;
  role: "assistant" | "owner" | "customer";
  text: string;
  at: string;
};

export type WidgetInstallation = {
  id: string;
  mode: "practice" | "workspace";
  business: BusinessProfile;
  identity: AssistantIdentity;
  modelProvider: ModelProviderId;
  suggestedQuestions: readonly string[];
};

const demoInstallation: WidgetInstallation = {
  id: DEMO_WIDGET_INSTALLATION_ID,
  mode: "practice",
  business: sampleBusiness,
  identity: identityForPurpose("booking"),
  modelProvider: "practice",
  suggestedQuestions: [
    "When are you open?",
    "What services do you offer?",
    "Is parking available?",
  ],
};

export function getWidgetInstallation(id: string) {
  return id === DEMO_WIDGET_INSTALLATION_ID ? demoInstallation : null;
}
