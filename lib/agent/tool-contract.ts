import type { z } from "zod";

import type { AgentContext } from "./context";

/**
 * What a tool is allowed to do.
 *
 * - read_only      never changes anything
 * - internal_write changes HelloCrew's own data only
 * - needs_approval records an intent; the owner decides, and only then does
 *                  anything leave HelloCrew
 */
export type ToolEffect = "read_only" | "internal_write" | "needs_approval";

/** Which data the tool may touch. Enforced by the server, declared here. */
export type ToolScope =
  | "none"
  | "conversation"
  | "tenant";

/**
 * An outside system the tool cannot work without. A contract naming one is
 * only offered to the model when that integration is connected, so the model
 * can never reach for a provider the business has not set up.
 */
export type IntegrationId =
  | "google_calendar"
  | "google_business"
  | "meta"
  | "whatsapp"
  | "booking_provider"
  | "crm"
  | "payments";

/**
 * The plug standard every tool and future SaaS plugin implements.
 *
 * The point is that nothing about a tool's permissions lives anywhere else:
 * effect, scope, approval, the integration it needs, how a repeat call is
 * recognised and what gets written to the audit trail all travel with the
 * tool. The previous design kept the effect in a separate map keyed by name,
 * so a new tool could be added with no effect at all.
 */
export type ToolContract<Schema extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string;
  description: string;
  schema: Schema;

  effect: ToolEffect;
  scope: ToolScope;
  /** "owner" means a person must approve before anything leaves HelloCrew. */
  approval: "none" | "owner";
  /** null means the tool works with no outside system connected. */
  requires: IntegrationId | null;

  /**
   * Stable key for one logical action, so a retry, a duplicate webhook or a
   * replayed approval cannot perform it twice. Required for anything that
   * writes; meaningless for reads.
   */
  idempotencyKey?: (args: z.infer<Schema>, context: AgentContext) => string;

  /** What the audit trail should say this call was. */
  audit: {
    action: string;
    /** True when the arguments can carry customer personal data. */
    recordsPii: boolean;
  };

  /** Owner switches and connected integrations decide what is offered. */
  isEnabled: (context: AgentContext) => boolean;

  /**
   * Tools that replace this one. When any of them is offered in the same
   * turn, this one is withheld.
   *
   * Two tools for the same job is not a harmless overlap: the model picks
   * one, and if it picks the weaker one the stronger one's guarantees are
   * simply absent. Declared here rather than in a list somewhere else, so a
   * tool that supersedes another cannot drift away from the one it replaces.
   */
  supersededBy?: readonly string[];

  run: (args: z.infer<Schema>, context: AgentContext) => Promise<string> | string;
};

/** A write contract must say how a repeat of the same action is recognised. */
export function assertContractIsSound(contract: ToolContract): void {
  const writes = contract.effect !== "read_only";
  if (writes && !contract.idempotencyKey)
    throw new Error(
      `Tool "${contract.name}" writes but declares no idempotencyKey.`,
    );
  if (contract.effect === "needs_approval" && contract.approval !== "owner")
    throw new Error(
      `Tool "${contract.name}" needs approval but no approver is set.`,
    );
  if (contract.effect === "read_only" && contract.approval !== "none")
    throw new Error(
      `Tool "${contract.name}" is read-only but asks for approval.`,
    );
}

/** Contracts the model may actually be offered for this turn. */
export function availableContracts(
  contracts: ToolContract[],
  context: AgentContext,
  connectedIntegrations: ReadonlySet<IntegrationId> = new Set(),
): ToolContract[] {
  const usable = contracts.filter((contract) => {
    if (!contract.isEnabled(context)) return false;
    // An unconnected integration means the tool is not offered at all, rather
    // than offered and failing halfway through.
    if (contract.requires && !connectedIntegrations.has(contract.requires))
      return false;
    return true;
  });

  // Resolved against what survived the first pass, so a tool is only withheld
  // for a replacement that is genuinely on offer this turn.
  const offered = new Set(usable.map((contract) => contract.name));
  return usable.filter(
    (contract) =>
      !contract.supersededBy?.some((name) => offered.has(name)),
  );
}
