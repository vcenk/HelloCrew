import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ToolNarrowing } from "@/lib/agent/tool-contract";
import { loadDocuments, type WorkspaceContext } from "@/lib/data/workspace";
import { parseWorkflowStore } from "@/lib/workflow-lifecycle";
import { selectWorkflowPolicy } from "@/lib/workflow-policy";

/**
 * The published workflow governing one conversation, if there is one.
 *
 * Returns null far more often than not, and null means the agent behaves
 * exactly as it did before workflows reached the runtime at all: no workflows
 * saved, none published, or none whose trigger matches this channel.
 *
 * Only ever read from the workspace document, which is the signed-in store.
 * The browser keeps a local copy for signed-out drafting; that copy never
 * reaches a real customer's conversation because it is never read here.
 */
export async function workflowPolicyFor(
  admin: SupabaseClient,
  workspace: Pick<WorkspaceContext, "tenantId">,
  channel: string,
): Promise<ToolNarrowing | null> {
  if (!channel) return null;

  try {
    const documents = await loadDocuments(admin, workspace);
    const stored = documents.workflows;
    if (!stored) return null;

    const { policy, warnings } = selectWorkflowPolicy(
      parseWorkflowStore(stored.document).workflows,
      channel,
    );
    if (!policy) return null;

    // Always logged, not only on warnings: when a workflow starts deciding
    // what a customer can be offered, "which one, and what did it allow" is
    // the first question anybody asks.
    const withheld = [...policy.governedTools].filter(
      (tool) => !policy.allowedTools.has(tool),
    );
    console.info(
      `[workflow] ${policy.workflowName} v${policy.version} governs ${channel}; ` +
        `allows ${[...policy.allowedTools].join(", ") || "nothing"}; ` +
        `withholds ${withheld.join(", ") || "nothing"}` +
        (warnings.length > 0 ? ` — ${warnings.join(" ")}` : ""),
    );

    return {
      governedTools: policy.governedTools,
      allowedTools: policy.allowedTools,
    };
  } catch (error) {
    // A workflow that cannot be read must not take the conversation down with
    // it. Falling back to no policy is the same as having no workflow, which
    // is the behaviour every workspace had until now.
    console.error(
      "[workflow] could not apply a workflow policy:",
      error instanceof Error ? error.message : "unknown",
    );
    return null;
  }
}
