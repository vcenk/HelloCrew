import type { ThreadChannel } from "@/lib/conversations";

import type { LiveAiStatus } from "@/app/app/actions";
import type { Account } from "./workspace-sync";
import type { Engine } from "./use-conversations";

export type OperatingModeId =
  | "guest_practice"
  | "practice"
  | "live"
  | "live_unavailable"
  | "human";

export type OperatingMode = {
  id: OperatingModeId;
  /** Short label for the topbar badge. */
  label: string;
  /** One sentence a non-technical owner can act on. */
  detail: string;
  /** Drives the badge's shape and icon, never colour on its own. */
  tone: "neutral" | "practice" | "live" | "human" | "warning";
  /** True when a reply could cost money. Never true for practice. */
  billable: boolean;
};

/**
 * The single source of truth for "what will happen if a message arrives right
 * now". Pure on purpose: the topbar badge, the Conversations header and the
 * unit tests all derive from this rather than hardcoding a label.
 *
 * Order matters. A human in the chat beats everything else, because no model
 * replies at all while someone has taken over.
 */
export function operatingMode({
  account,
  engine,
  live,
  conversationMode,
  channel,
}: {
  account: Account;
  engine: Engine;
  live: LiveAiStatus | null;
  conversationMode?: "ai" | "human";
  channel?: ThreadChannel;
}): OperatingMode {
  if (conversationMode === "human") {
    return {
      id: "human",
      label: "You’re replying",
      detail:
        "You have taken over this conversation. Nothing is answered automatically until you hand it back.",
      tone: "human",
      billable: false,
    };
  }

  if (account.status !== "signed_in") {
    return {
      id: "guest_practice",
      label: "Guest practice",
      detail:
        "Answers come from saved facts in this browser. No account, no paid AI calls, and nothing is really booked or sent.",
      tone: "neutral",
      billable: false,
    };
  }

  if (engine === "live") {
    // Selecting live does not make it available: the workspace still needs a
    // configured provider and the owner's switch turned on.
    if (live?.state === "ready" && live.enabled) {
      return {
        id: "live",
        label: "Live AI",
        detail:
          channel && channel !== "test"
            ? "Replies are written by the AI model and sent to real customers. They count against your monthly budget."
            : "Replies are written by the AI model and count against your monthly budget. This is a test chat, so nothing reaches a customer.",
        tone: "live",
        billable: true,
      };
    }
    return {
      id: "live_unavailable",
      label: "Live AI unavailable",
      detail:
        live?.state === "not_configured"
          ? "Live AI is selected but not set up yet, so replies fall back to your saved answers."
          : "Live AI is selected but switched off, so replies fall back to your saved answers.",
      tone: "warning",
      billable: false,
    };
  }

  return {
    id: "practice",
    label: "Practice",
    detail:
      "Replies come from your saved answers with fixed rules. No AI model is called and nothing is booked or sent.",
    tone: "practice",
    billable: false,
  };
}
