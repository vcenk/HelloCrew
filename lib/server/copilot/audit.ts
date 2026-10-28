import "server-only";

import type { CopilotActionMeta } from "@/lib/copilot/contracts";
import type { WorkspaceContext } from "@/lib/data/workspace";

/**
 * Records that an owner action happened.
 *
 * A structured server-side log, not a table. There is no audit table in this
 * schema, and adding one means a migration somebody has to apply before the
 * Copilot works at all — so this is deliberately the smaller promise. The
 * shape is stable enough to ship to a log collector or to back a table later.
 *
 * Nothing here writes the content of a document or a customer's details: an
 * audit line says who did what to which resource, not what it said.
 */
export type CopilotAuditEvent = {
  event: string;
  tenantId: string;
  userId: string;
  role: string;
  action: string;
  safety: string;
  resource: string;
  outcome: "applied" | "partial" | "rejected" | "failed" | "draft" | "refused";
  /** Counts only — never the text that was added. */
  applied?: number;
  skipped?: number;
  reason?: string;
  at: string;
};

export function recordCopilotAudit(
  workspace: Pick<WorkspaceContext, "tenantId" | "userId" | "role">,
  action: Pick<CopilotActionMeta, "name" | "safety" | "resource" | "audit">,
  outcome: CopilotAuditEvent["outcome"],
  detail: { applied?: number; skipped?: number; reason?: string } = {},
): CopilotAuditEvent {
  const entry: CopilotAuditEvent = {
    event: action.audit.event,
    tenantId: workspace.tenantId,
    userId: workspace.userId,
    role: workspace.role,
    action: action.name,
    safety: action.safety,
    resource: action.resource,
    outcome,
    ...detail,
    at: new Date().toISOString(),
  };
  console.info("[copilot.audit]", JSON.stringify(entry));
  return entry;
}
