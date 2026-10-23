import { Bot, CircleAlert, FlaskConical, Hand, Zap } from "lucide-react";

import type { OperatingMode } from "./operating-mode";

const icons = {
  guest_practice: FlaskConical,
  practice: FlaskConical,
  live: Zap,
  live_unavailable: CircleAlert,
  human: Hand,
} as const;

/**
 * Says what will happen to the next message. The icon and the words carry the
 * meaning together, so the tone colour is never the only signal.
 */
export function ModeBadge({
  mode,
  size = "md",
}: {
  mode: OperatingMode;
  size?: "sm" | "md";
}) {
  const Icon = icons[mode.id] ?? Bot;
  return (
    <span
      className="dash-mode"
      data-tone={mode.tone}
      data-size={size}
      data-billable={mode.billable}
      title={mode.detail}
    >
      <Icon size={size === "sm" ? 13 : 14} aria-hidden="true" />
      <span>{mode.label}</span>
    </span>
  );
}
