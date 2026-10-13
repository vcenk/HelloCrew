import { describe, expect, it } from "vitest";
import {
  createWorkflowRecord,
  parseWorkflowStore,
  publishWorkflowVersion,
  saveWorkflowDraft,
  setWorkflowArchived,
} from "../lib/workflow-lifecycle";
import { salonReceptionWorkflow } from "../lib/workflow";

const NOW = "2026-10-12T10:00:00.000Z";

describe("workflow lifecycle", () => {
  it("migrates the original browser storage without losing the draft", () => {
    const store = parseWorkflowStore([
      {
        workflow: salonReceptionWorkflow,
        sourceTemplateId: "salon-reception",
        structureLocked: true,
        savedAt: NOW,
      },
    ]);
    expect(store.formatVersion).toBe(2);
    expect(store.workflows[0]).toMatchObject({
      sourceTemplateId: "salon-reception",
      lifecycle: "draft",
      compatibility: "current",
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it("publishes immutable snapshots and keeps the editable draft separate", () => {
    const record = createWorkflowRecord(salonReceptionWorkflow, { now: NOW });
    const first = publishWorkflowVersion(record, record.workflow, NOW);
    const changedDraft = structuredClone(first.workflow);
    changedDraft.name = "Edited after publishing";
    const saved = saveWorkflowDraft(
      first,
      changedDraft,
      "2026-10-12T11:00:00.000Z",
    );
    const second = publishWorkflowVersion(
      saved,
      saved.workflow,
      "2026-10-12T12:00:00.000Z",
    );

    expect(second.publishedVersions.map((item) => item.version)).toEqual([
      1, 2,
    ]);
    expect(second.publishedVersions[0].name).toBe("Salon reception assistant");
    expect(second.publishedVersions[1].name).toBe("Edited after publishing");
    expect(second.workflow.status).toBe("draft");
  });

  it("refuses to publish invalid workflows", () => {
    const record = createWorkflowRecord(salonReceptionWorkflow, { now: NOW });
    const invalid = { ...record.workflow, edges: [] };
    expect(() => publishWorkflowVersion(record, invalid, NOW)).toThrow(
      "Fix workflow validation issues",
    );
  });

  it("archives and restores the correct lifecycle", () => {
    const record = publishWorkflowVersion(
      createWorkflowRecord(salonReceptionWorkflow, { now: NOW }),
    );
    const archived = setWorkflowArchived(record, true, NOW);
    expect(archived.lifecycle).toBe("archived");
    expect(setWorkflowArchived(archived, false, NOW).lifecycle).toBe(
      "published",
    );
  });
});
