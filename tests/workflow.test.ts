import { describe, expect, it } from "vitest";
import {
  createWorkflowFromTemplate,
  googleReviewAssistantWorkflow,
  salonReceptionWorkflow,
  validateWorkflow,
  workflowTemplates,
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

  it("requires owner approval before a public Google review reply", () => {
    const workflow = structuredClone(googleReviewAssistantWorkflow);
    workflow.edges = workflow.edges.filter(
      (edge) => edge.id !== "e-review-approval-post",
    );
    workflow.edges.push({
      id: "e-review-direct-post",
      source: "review-draft",
      target: "google-review-reply",
    });
    expect(validateWorkflow(workflow)).toContainEqual(
      expect.objectContaining({
        code: "approval_required",
        nodeId: "google-review-reply",
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

  it("ships only valid starter templates", () => {
    expect(workflowTemplates.length).toBeGreaterThanOrEqual(4);
    for (const template of workflowTemplates) {
      expect(validateWorkflow(template.workflow), template.name).toEqual([]);
    }
  });

  it("includes a configurable Google review assistant template", () => {
    const template = workflowTemplates.find(
      (item) => item.id === "google-review-assistant",
    );
    expect(template?.category).toBe("Reputation");
    expect(template?.workflow.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "trigger.google_review" }),
        expect.objectContaining({ kind: "action.google_review_reply" }),
        expect.objectContaining({ kind: "handoff.review_follow_up" }),
      ]),
    );
  });

  it("creates an independent workflow copy from a template", () => {
    const copy = createWorkflowFromTemplate(
      "salon-reception",
      "tenant-workflow-1",
    );
    expect(copy).not.toBeNull();
    expect(copy?.id).toBe("tenant-workflow-1");
    copy!.nodes[0].label = "Changed trigger";
    expect(salonReceptionWorkflow.nodes[0].label).toBe("Website message");
  });
});
