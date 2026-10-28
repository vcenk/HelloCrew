import type { WorkspaceRole } from "@/lib/data/workspace";
import {
  needsConfirmation,
  roleAllows,
  type CopilotActionMeta,
  type SafetyLevel,
} from "./contracts";
import { findCopilotAction } from "./registry";

/**
 * The one gate between a model's tool call and anything happening.
 *
 * Deliberately a single function returning a tagged result rather than a set
 * of booleans a caller can forget to check: every refusal reason is in here,
 * and the server has one thing to call.
 */

export type PolicyRefusal = {
  allowed: false;
  reason: "unknown_action" | "forbidden" | "not_connected" | "bad_input";
  message: string;
};

export type PolicyAllowance = {
  allowed: true;
  action: CopilotActionMeta;
  safety: SafetyLevel;
  /** True when the owner must say yes before anything is applied. */
  confirm: boolean;
};

export type PolicyDecision = PolicyRefusal | PolicyAllowance;

export type PolicyRequest = {
  /** The name the model asked for. Untrusted. */
  name: string;
  role: WorkspaceRole;
  /** Integrations this workspace has actually connected. */
  connected: ReadonlySet<string>;
};

export function decideCopilotAction(request: PolicyRequest): PolicyDecision {
  const action = findCopilotAction(request.name);
  // An unregistered name is not an error to explain to the model in detail;
  // it is simply not a thing that exists.
  if (!action)
    return {
      allowed: false,
      reason: "unknown_action",
      message: `There is no action called "${request.name}".`,
    };

  if (!roleAllows(request.role, action.requiredRole))
    return {
      allowed: false,
      reason: "forbidden",
      message:
        request.role === "viewer"
          ? "Viewers can look but not change anything."
          : "That needs an owner.",
    };

  if (action.requires && !request.connected.has(action.requires))
    return {
      allowed: false,
      reason: "not_connected",
      message: `That needs ${action.requires} connected first.`,
    };

  return {
    allowed: true,
    action,
    // Read from the registered action, never from whatever the model said.
    safety: action.safety,
    confirm: needsConfirmation(action.safety),
  };
}
