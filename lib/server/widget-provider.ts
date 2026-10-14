import "server-only";

import { answerFromBusiness } from "@/lib/business";
import type { WidgetInstallation } from "@/lib/widget";

export type WidgetReply = {
  reply: string;
  source: string;
  engine: "practice";
};

export function respondToWidgetMessage(
  installation: WidgetInstallation,
  message: string,
): WidgetReply {
  const result = answerFromBusiness(installation.business, message);

  return {
    reply:
      result.source === "No matching information"
        ? `${installation.identity.fallback} This public demo has not contacted anyone.`
        : result.reply,
    source: result.source,
    engine: "practice",
  };
}
