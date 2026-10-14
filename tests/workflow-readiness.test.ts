import { describe, expect, it } from "vitest";

import {
  createWorkflowRecord,
  publishWorkflowVersion,
  setWorkflowArchived,
} from "../lib/workflow-lifecycle";
import {
  parseStoredWorkflowReadiness,
  summarizeWorkflowReadiness,
} from "../lib/workflow-readiness";
import { salonReceptionWorkflow } from "../lib/workflow";

const NOW = "2026-10-12T10:00:00.000Z";

describe("workflow readiness", () => {
  it("returns missing for empty or invalid browser storage", () => {
    expect(parseStoredWorkflowReadiness(null)).toEqual({ status: "missing" });
    expect(parseStoredWorkflowReadiness("not-json")).toEqual({
      status: "missing",
    });
  });

  it("reports the most recently updated active draft", () => {
    const older = createWorkflowRecord(salonReceptionWorkflow, { now: NOW });
    const newer = createWorkflowRecord(
      { ...salonReceptionWorkflow, id: "newer", name: "Newer workflow" },
      { now: "2026-10-12T11:00:00.000Z" },
    );

    expect(summarizeWorkflowReadiness([older, newer])).toEqual({
      status: "draft",
      name: "Newer workflow",
      workflowId: "newer",
      version: undefined,
    });
  });

  it("reports the latest immutable published version", () => {
    const first = publishWorkflowVersion(
      createWorkflowRecord(salonReceptionWorkflow, { now: NOW }),
      undefined,
      "2026-10-12T11:00:00.000Z",
    );
    const second = publishWorkflowVersion(
      first,
      undefined,
      "2026-10-12T12:00:00.000Z",
    );

    expect(summarizeWorkflowReadiness([second])).toMatchObject({
      status: "published",
      name: "Salon reception assistant",
      version: 2,
    });
  });

  it("ignores archived workflows", () => {
    const archived = setWorkflowArchived(
      createWorkflowRecord(salonReceptionWorkflow, { now: NOW }),
      true,
      NOW,
    );
    expect(summarizeWorkflowReadiness([archived])).toEqual({
      status: "missing",
    });
  });
});
