import type { ChangeOperation, ChangeSet } from "./contracts";
import { applyWorkflowOperations, type WorkflowOperation } from "./workflow-ops";
import { validateWorkflow, type WorkflowDefinition } from "@/lib/workflow";
import {
  compileWorkflowPolicy,
  type WorkflowRuntimePolicy,
} from "@/lib/workflow-policy";
import type { WorkflowRecord } from "@/lib/workflow-lifecycle";

/**
 * What a set of workflow edits would do, before any of it is saved.
 *
 * Every candidate is validated and then put through the same runtime
 * compiler the live agent uses, so the owner is told two different things:
 * whether the drawing is coherent, and whether it would actually change what
 * their crew does. A workflow that validates perfectly and compiles to
 * nothing is a real outcome, and saying so is the whole point.
 */

export type WorkflowChangePlan = {
  changes: ChangeSet;
  candidate: WorkflowDefinition;
  /** True when the result could be published as it stands. */
  valid: boolean;
};

/** What the compiled policy would mean, in the owner's words. */
function describePolicy(policy: WorkflowRuntimePolicy): string[] {
  const allows = [...policy.allowedTools];
  const withholds = [...policy.governedTools].filter(
    (tool) => !policy.allowedTools.has(tool),
  );
  const lines = [
    `Once published, this governs ${policy.channel} conversations.`,
  ];
  if (withholds.length > 0)
    lines.push(
      `Your crew would no longer be able to: ${withholds.join(", ")}.`,
    );
  else if (allows.length > 0)
    lines.push("It takes nothing away from what your crew can already do.");
  return lines;
}

export function buildWorkflowChangeSet(input: {
  id: string;
  record: WorkflowRecord;
  operations: readonly WorkflowOperation[];
  /** What the owner asked for, echoed back so the card reads sensibly. */
  title: string;
}): WorkflowChangePlan {
  const { record, operations } = input;
  const applied = applyWorkflowOperations(record.workflow, operations);
  const issues = validateWorkflow(applied.workflow);
  const valid = issues.length === 0;

  const changeOperations: ChangeOperation[] = applied.outcomes.map(
    (outcome, index) => ({
      id: `${input.id}-${index}`,
      kind:
        outcome.operation.op === "remove_node" ||
        outcome.operation.op === "disconnect"
          ? "remove"
          : outcome.operation.op === "add_node"
            ? "add"
            : "update",
      resource: "workflow",
      title: outcome.describes,
      summary: outcome.refused ? "Not applied." : "",
      // A refused operation is shown and switched off rather than hidden, so
      // the owner can see the whole of what they asked for.
      duplicate: false,
      selected: !outcome.refused,
      ...(outcome.refused
        ? {
            conflict: {
              withTitle: "Could not be done",
              explanation: outcome.refused,
            },
          }
        : {}),
    }),
  );

  const notes: string[] = [];
  for (const issue of issues) notes.push(issue.message);

  // Run the compiler even on an invalid draft: "it does not validate" and
  // "it would change nothing" are different problems and the owner may have
  // both.
  let affectsLiveBehaviour = false;
  if (valid) {
    const compiled = compileWorkflowPolicy({
      ...record,
      lifecycle: "published",
      compatibility: "current",
      publishedVersions: [
        { ...applied.workflow, status: "published", version: 1 },
      ],
    });
    if (compiled.ok) {
      notes.push(...describePolicy(compiled.policy));
      notes.push(...compiled.policy.warnings);
      affectsLiveBehaviour =
        [...compiled.policy.governedTools].some(
          (tool) => !compiled.policy.allowedTools.has(tool),
        );
    } else {
      notes.push(`This would not govern any conversation: ${compiled.reason}`);
    }
  }

  return {
    changes: {
      id: input.id,
      action: "workflow_update_draft",
      title: input.title,
      summary: valid
        ? `${changeOperations.filter((operation) => operation.selected).length} change${
            changeOperations.length === 1 ? "" : "s"
          } to “${applied.workflow.name}”. This stays a draft — publishing is a separate step.`
        : `“${applied.workflow.name}” would not be valid, so it cannot be published as it stands.`,
      operations: changeOperations,
      affectsCrew: [],
      // A draft governs nothing at all until it is published. Saying
      // otherwise on the card would be the exact lie this work exists to stop.
      affectsLiveBehaviour: false,
      notes: [
        ...notes,
        ...(affectsLiveBehaviour
          ? ["Publishing this would change what your crew is allowed to do."]
          : []),
      ],
    },
    candidate: applied.workflow,
    valid,
  };
}
