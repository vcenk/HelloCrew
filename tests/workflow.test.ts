import { describe, expect, it } from "vitest";
import {
  salonReceptionWorkflow,
  validateWorkflow,
  type WorkflowDefinition,
} from "../lib/workflow";

function copyWorkflow(): WorkflowDefinition {
  return structuredClone(salonReceptionWorkflow);
}

describe("workflow validation", () => {
  it("accepts the salon starter workflow", () => {
    expect(validateWorkflow(copyWorkflow())).toEqual([]);
  });

  it("requires owner approval before a booking action", () => {
    const workflow = copyWorkflow();
    workflow.edges = workflow.edges.filter(
      (edge) => edge.id !== "e-approval-booking",
    );
    workflow.edges.push({
      id: "e-direct-booking",
      source: "website-message",
      target: "booking-action",
    });
    expect(validateWorkflow(workflow)).toContainEqual(
      expect.objectContaining({
        code: "approval_required",
        nodeId: "booking-action",
      }),
    );
  });

  it("finds unreachable nodes", () => {
    const workflow = copyWorkflow();
    workflow.edges = workflow.edges.filter(
      (edge) => edge.target !== "human-inbox",
    );
    expect(validateWorkflow(workflow)).toContainEqual(
      expect.objectContaining({
        code: "unreachable_node",
        nodeId: "human-inbox",
      }),
    );
  });

  it("rejects cycles", () => {
    const workflow = copyWorkflow();
    workflow.edges.push({
      id: "e-cycle",
      source: "website-reply",
      target: "website-message",
    });
    expect(validateWorkflow(workflow)).toContainEqual(
      expect.objectContaining({ code: "cycle" }),
    );
  });
});
