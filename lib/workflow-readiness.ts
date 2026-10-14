import { parseWorkflowStore, type WorkflowRecord } from "./workflow-lifecycle";

export const WORKFLOW_STORAGE_KEY = "hellocrew:workflows:v2";
export const LEGACY_WORKFLOW_STORAGE_KEY = "hellocrew:workflows:v1";

export type WorkflowReadiness = {
  status: "missing" | "draft" | "published";
  name?: string;
  version?: number;
  workflowId?: string;
};

export const missingWorkflowReadiness: WorkflowReadiness = {
  status: "missing",
};

export function summarizeWorkflowReadiness(
  workflows: WorkflowRecord[],
): WorkflowReadiness {
  const current = workflows
    .filter((record) => record.lifecycle !== "archived")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  if (!current) return missingWorkflowReadiness;

  const version = Math.max(
    0,
    ...current.publishedVersions.map((published) => published.version),
  );

  return {
    status: version > 0 ? "published" : "draft",
    name: current.workflow.name,
    version: version || undefined,
    workflowId: current.workflow.id,
  };
}

export function parseStoredWorkflowReadiness(
  raw: string | null,
): WorkflowReadiness {
  if (!raw) return missingWorkflowReadiness;

  try {
    return summarizeWorkflowReadiness(
      parseWorkflowStore(JSON.parse(raw)).workflows,
    );
  } catch {
    return missingWorkflowReadiness;
  }
}
