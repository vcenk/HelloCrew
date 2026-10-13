import { nodeJobDefinitions } from "./workflow-jobs";
import { validateWorkflow, type WorkflowDefinition } from "./workflow";

export type WorkflowPlanStep = {
  nodeId: string;
  label: string;
  jobId: string;
  effect: "read_only" | "internal_write" | "external_write";
  state: "simulated" | "approval_pause" | "integration_disabled";
  detail: string;
};

export type WorkflowTestPlan = {
  mode: "practice";
  steps: WorkflowPlanStep[];
  externalWrites: 0;
};

export function compilePracticePlan(
  workflow: WorkflowDefinition,
): WorkflowTestPlan {
  const issues = validateWorkflow(workflow);
  if (issues.length > 0)
    throw new Error("The workflow must be valid before it can be tested.");

  const byId = new Map(workflow.nodes.map((node) => [node.id, node]));
  const incoming = new Map(workflow.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of workflow.edges) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.set(edge.source, [
      ...(outgoing.get(edge.source) ?? []),
      edge.target,
    ]);
  }
  const queue = workflow.nodes
    .filter((node) => (incoming.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
  const ordered: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    ordered.push(id);
    for (const target of outgoing.get(id) ?? []) {
      incoming.set(target, (incoming.get(target) ?? 1) - 1);
      if (incoming.get(target) === 0) queue.push(target);
    }
  }

  return {
    mode: "practice",
    externalWrites: 0,
    steps: ordered.map((nodeId) => {
      const node = byId.get(nodeId)!;
      const job = nodeJobDefinitions[node.kind];
      const state =
        job.approvalPolicy === "required"
          ? "approval_pause"
          : job.requiredIntegration === "none"
            ? "simulated"
            : "integration_disabled";
      return {
        nodeId,
        label: node.label,
        jobId: job.jobId,
        effect: job.effect,
        state,
        detail:
          state === "approval_pause"
            ? "Practice run pauses here for an explicit decision."
            : state === "integration_disabled"
              ? `${job.requiredIntegration} is not connected; no outside action runs.`
              : "Runs with deterministic practice data only.",
      };
    }),
  };
}
