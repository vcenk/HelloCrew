import { describe, expect, it } from "vitest";
import { nodeJobDefinitions } from "../lib/workflow-jobs";
import { compilePracticePlan } from "../lib/workflow-runner";
import {
  salonReceptionWorkflow,
  workflowKinds,
  type WorkflowDefinition,
} from "../lib/workflow";

describe("allowlisted workflow jobs", () => {
  it("registers an explicit execution policy for every node kind", () => {
    expect(Object.keys(nodeJobDefinitions).sort()).toEqual(
      [...workflowKinds].sort(),
    );
    for (const kind of workflowKinds) {
      expect(nodeJobDefinitions[kind].jobId).not.toBe("unassigned");
      expect(nodeJobDefinitions[kind].timeoutMs).toBeGreaterThan(0);
      expect(nodeJobDefinitions[kind].idempotency.length).toBeGreaterThan(0);
    }
  });

  it("compiles a deterministic practice plan without external writes", () => {
    const plan = compilePracticePlan(salonReceptionWorkflow);
    expect(plan.mode).toBe("practice");
    expect(plan.externalWrites).toBe(0);
    expect(plan.steps[0].nodeId).toBe("website-message");
    expect(plan.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: "owner-approval",
          state: "approval_pause",
        }),
        expect.objectContaining({
          nodeId: "booking-action",
          state: "approval_pause",
          effect: "external_write",
        }),
      ]),
    );
  });

  it("rejects invalid graphs before compiling", () => {
    const invalid: WorkflowDefinition = {
      ...structuredClone(salonReceptionWorkflow),
      edges: [],
    };
    expect(() => compilePracticePlan(invalid)).toThrow(
      "must be valid before it can be tested",
    );
  });
});
