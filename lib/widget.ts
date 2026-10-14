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

export type WidgetInstallation = {
  id: string;
  mode: "practice";
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
