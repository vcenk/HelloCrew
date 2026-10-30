import { describe, expect, it } from "vitest";

import { buildWorkflowChangeSet } from "../lib/copilot/workflow-changes";
import {
  applyWorkflowOperations,
  workflowOperationSchema,
  type WorkflowOperation,
} from "../lib/copilot/workflow-ops";
import {
  salonReceptionWorkflow,
  validateWorkflow,
  type WorkflowDefinition,
} from "../lib/workflow";
import { createWorkflowRecord } from "../lib/workflow-lifecycle";

/**
 * The model never submits a workflow. It names operations from a closed list,
 * with values checked against the builder's own field definitions, and
 * deterministic code does the editing. These pin that shut.
 */

const base = (): WorkflowDefinition => structuredClone(salonReceptionWorkflow);
const nodeOf = (kind: string, workflow = base()) =>
  workflow.nodes.find((node) => node.kind === kind)!;

const apply = (operations: WorkflowOperation[], workflow = base()) =>
  applyWorkflowOperations(workflow, operations);

describe("what the model is allowed to ask for", () => {
  it.each([
    { op: "run_sql", sql: "drop table hc_tenants" },
    { op: "set_config", path: "/nodes/0/config", value: "x" },
    { op: "eval", code: "process.exit()" },
    { op: "add_node", kind: "action.wire_transfer" },
    {},
  ])("refuses %s", (operation) => {
    expect(workflowOperationSchema.safeParse(operation).success).toBe(false);
  });

  it("accepts only the operations on the list", () => {
    for (const operation of [
      { op: "set_name", name: "Reception" },
      { op: "add_node", kind: "handoff.inbox" },
      { op: "remove_node", nodeId: "x" },
      { op: "connect", source: "a", target: "b" },
      { op: "disconnect", edgeId: "e" },
      { op: "move_node", nodeId: "x", position: { x: 1, y: 2 } },
      { op: "update_node", nodeId: "x", config: { tone: "Calm and professional" } },
    ])
      expect(
        workflowOperationSchema.safeParse(operation).success,
        JSON.stringify(operation),
      ).toBe(true);
  });
});

describe("changing a step's settings", () => {
  it("refuses a setting that step does not have", () => {
    const knowledge = nodeOf("knowledge.search");
    const { outcomes } = apply([
      { op: "update_node", nodeId: knowledge.id, config: { admin: "true" } },
    ]);
    expect(outcomes[0].refused).toMatch(/not a setting/i);
  });

  it("refuses a value outside the choices the builder offers", () => {
    const respond = nodeOf("ai.respond");
    const { outcomes } = apply([
      { op: "update_node", nodeId: respond.id, config: { tone: "Sarcastic" } },
    ]);
    expect(outcomes[0].refused).toMatch(/must be one of/i);
  });

  it("accepts a value the builder itself offers", () => {
    const respond = nodeOf("ai.respond");
    const { workflow, outcomes } = apply([
      {
        op: "update_node",
        nodeId: respond.id,
        config: { tone: "Calm and professional" },
      },
    ]);
    expect(outcomes[0].refused).toBeUndefined();
    expect(
      workflow.nodes.find((node) => node.id === respond.id)?.config.tone,
    ).toBe("Calm and professional");
  });
});

describe("adding and removing steps", () => {
  it("inserts a new step into the flow rather than beside it", () => {
    // A node nobody connected is unreachable, and unreachable does not
    // validate — so "added" would mean "broke it".
    const knowledge = nodeOf("knowledge.search");
    const { workflow } = apply([
      { op: "add_node", kind: "handoff.inbox", after: knowledge.id },
    ]);
    expect(validateWorkflow(workflow)).toEqual([]);
  });

  it("bridges around a removed step so the rest still connects", () => {
    const confidence = nodeOf("logic.confidence");
    const { workflow } = apply([{ op: "remove_node", nodeId: confidence.id }]);
    expect(workflow.nodes.some((node) => node.id === confidence.id)).toBe(false);
    expect(validateWorkflow(workflow)).toEqual([]);
  });

  it("says so plainly when a step does not exist", () => {
    const { outcomes } = apply([{ op: "remove_node", nodeId: "nope" }]);
    expect(outcomes[0].refused).toMatch(/no step called/i);
  });

  it("applies what it can and refuses the rest, in order", () => {
    const respond = nodeOf("ai.respond");
    const { workflow, outcomes } = apply([
      { op: "set_name", name: "Front desk" },
      { op: "remove_node", nodeId: "nope" },
      { op: "update_node", nodeId: respond.id, config: { tone: "Calm and professional" } },
    ]);
    expect(workflow.name).toBe("Front desk");
    expect(outcomes.map((outcome) => Boolean(outcome.refused))).toEqual([
      false,
      true,
      false,
    ]);
  });

  it("never changes the workflow it was given", () => {
    const original = base();
    const snapshot = JSON.stringify(original);
    apply([{ op: "set_name", name: "Changed" }], original);
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

describe("what the owner is shown before anything is saved", () => {
  const record = () => createWorkflowRecord(base());

  it("reports both whether it is valid and what it would govern", () => {
    const plan = buildWorkflowChangeSet({
      id: "cs1",
      record: record(),
      operations: [{ op: "set_name", name: "Front desk" }],
      title: "Rename",
    });
    expect(plan.valid).toBe(true);
    expect(plan.changes.notes.join(" ")).toMatch(/governs website/i);
  });

  it("never claims a draft changes live behaviour", () => {
    // A draft governs nothing until it is published. Saying otherwise on the
    // card is the exact lie this whole phase exists to stop.
    const plan = buildWorkflowChangeSet({
      id: "cs1",
      record: record(),
      operations: [{ op: "set_name", name: "Front desk" }],
      title: "Rename",
    });
    expect(plan.changes.affectsLiveBehaviour).toBe(false);
  });

  it("warns that publishing would take a capability away", () => {
    const handoff = nodeOf("handoff.inbox");
    const plan = buildWorkflowChangeSet({
      id: "cs1",
      record: record(),
      operations: [{ op: "remove_node", nodeId: handoff.id }],
      title: "Remove handoff",
    });
    expect(plan.valid).toBe(true);
    expect(plan.changes.notes.join(" ")).toMatch(/no longer be able to/i);
  });

  it("says it cannot be published when the result is invalid", () => {
    const trigger = nodeOf("trigger.website");
    const plan = buildWorkflowChangeSet({
      id: "cs1",
      record: record(),
      operations: [{ op: "remove_node", nodeId: trigger.id }],
      title: "Remove trigger",
    });
    expect(plan.valid).toBe(false);
    expect(plan.changes.summary).toMatch(/cannot be published/i);
  });

  it("shows a refused operation rather than hiding it", () => {
    const plan = buildWorkflowChangeSet({
      id: "cs1",
      record: record(),
      operations: [{ op: "remove_node", nodeId: "nope" }],
      title: "Remove something",
    });
    const [operation] = plan.changes.operations;
    expect(operation.selected).toBe(false);
    expect(operation.conflict?.explanation).toMatch(/no step called/i);
  });
});

describe("taking an approval off something that books", () => {
  it("leaves the workflow unpublishable, which validation catches", () => {
    // The product rule, already enforced by validateWorkflow: anything that
    // acts on the owner's behalf waits for them.
    const approval = nodeOf("approval.owner");
    const { workflow } = apply([{ op: "remove_node", nodeId: approval.id }]);
    const issues = validateWorkflow(workflow);
    expect(issues.some((issue) => issue.code === "approval_required")).toBe(true);
  });

  it("is reported as a problem the owner has to see", () => {
    const approval = nodeOf("approval.owner");
    const plan = buildWorkflowChangeSet({
      id: "cs1",
      record: createWorkflowRecord(base()),
      operations: [{ op: "remove_node", nodeId: approval.id }],
      title: "Remove approval",
    });
    expect(plan.valid).toBe(false);
    expect(plan.changes.notes.join(" ")).toMatch(/approval/i);
  });
});
