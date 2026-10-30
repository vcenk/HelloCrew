import { beforeEach, describe, expect, it, vi } from "vitest";

const loadDocuments = vi.fn();
const saveDocument = vi.fn();

vi.mock("@/lib/data/workspace", () => ({
  loadDocuments: (...args: unknown[]) => loadDocuments(...args),
  saveDocument: (...args: unknown[]) => saveDocument(...args),
}));

const {
  applyWorkflowEdit,
  copilotPublishWorkflow,
  undoWorkflowChange,
} = await import("../lib/server/copilot/workflow");
const { createWorkflowRecord, publishWorkflowVersion, WORKFLOW_STORAGE_VERSION } =
  await import("../lib/workflow-lifecycle");
const { salonReceptionWorkflow } = await import("../lib/workflow");

/**
 * The Copilot and the canvas write the same document. These cover what has to
 * happen when they reach for it at the same time, and what must not happen
 * when an owner asks for something the product does not allow.
 */

const workspace = {
  userId: "u1",
  email: null,
  tenantId: "t1",
  tenantName: "T",
  role: "owner" as const,
};
const db = {} as never;

const record = () => createWorkflowRecord(structuredClone(salonReceptionWorkflow));
const nodeOf = (kind: string) =>
  salonReceptionWorkflow.nodes.find((node) => node.kind === kind)!;

function storeAt(version: number, workflows: unknown[]) {
  loadDocuments.mockResolvedValue({
    workflows: {
      version,
      document: { formatVersion: WORKFLOW_STORAGE_VERSION, workflows },
    },
  });
}

beforeEach(() => {
  loadDocuments.mockReset();
  saveDocument.mockReset();
  saveDocument.mockResolvedValue({ ok: true, version: 2 });
});

describe("two people editing the same workflow", () => {
  it("refuses an edit based on a version that has moved", async () => {
    // Somebody saved on the canvas while the owner was reading the card.
    storeAt(7, [record()]);
    const result = await applyWorkflowEdit(db, workspace, {
      workflowId: salonReceptionWorkflow.id,
      expectedVersion: 6,
      operations: [{ op: "set_name", name: "Front desk" }],
    });

    expect(result.status).toBe("failed");
    expect(result.summary).toMatch(/changed while you were looking/i);
    expect(saveDocument).not.toHaveBeenCalled();
  });

  it("refuses to publish on a version that has moved", async () => {
    storeAt(7, [record()]);
    const result = await copilotPublishWorkflow(db, workspace, {
      workflowId: salonReceptionWorkflow.id,
      expectedVersion: 6,
    });
    expect(result.status).toBe("failed");
    expect(saveDocument).not.toHaveBeenCalled();
  });

  it("saves when the version still matches", async () => {
    storeAt(6, [record()]);
    const result = await applyWorkflowEdit(db, workspace, {
      workflowId: salonReceptionWorkflow.id,
      expectedVersion: 6,
      operations: [{ op: "set_name", name: "Front desk" }],
    });

    expect(result.status).toBe("draft");
    expect(saveDocument).toHaveBeenCalledOnce();
    // Written with the version it read, so the database settles the race too.
    expect(saveDocument.mock.calls[0][3]).toBe(6);
  });

  it("still saves when the browser had no version to report", async () => {
    // Null is "this page never loaded the document", not "skip the checks":
    // the compare-and-swap below still runs against the version just read.
    storeAt(6, [record()]);
    const result = await applyWorkflowEdit(db, workspace, {
      workflowId: salonReceptionWorkflow.id,
      expectedVersion: null,
      operations: [{ op: "set_name", name: "Front desk" }],
    });

    expect(result.status).toBe("draft");
    expect(saveDocument.mock.calls[0][3]).toBe(6);
  });

  it("lets the database refuse an edit the browser could not know about", async () => {
    // The canvas saved between our read and our write. Nothing the page
    // reported could have caught this one — only the compare-and-swap does.
    storeAt(6, [record()]);
    saveDocument.mockResolvedValue({ ok: false, reason: "conflict" });
    const result = await applyWorkflowEdit(db, workspace, {
      workflowId: salonReceptionWorkflow.id,
      expectedVersion: null,
      operations: [{ op: "set_name", name: "Front desk" }],
    });

    expect(result.status).toBe("failed");
    expect(result.summary).toMatch(/changed while you were looking/i);
  });

  it("reports a conflict the database caught rather than claiming success", async () => {
    storeAt(6, [record()]);
    saveDocument.mockResolvedValue({ ok: false, reason: "conflict" });
    const result = await applyWorkflowEdit(db, workspace, {
      workflowId: salonReceptionWorkflow.id,
      expectedVersion: 6,
      operations: [{ op: "set_name", name: "Front desk" }],
    });
    expect(result.status).toBe("failed");
    expect(result.summary).toMatch(/changed while you were looking/i);
  });
});

describe("asking to take the approval off a booking", () => {
  it("is refused, not written down to fail later", async () => {
    // The brief's own case: "do not require approval for consultations".
    // Obeying and leaving an unpublishable draft would be obeying and hiding
    // it; the owner needs to know the product does not allow this.
    storeAt(6, [record()]);
    const result = await applyWorkflowEdit(db, workspace, {
      workflowId: salonReceptionWorkflow.id,
      expectedVersion: 6,
      operations: [{ op: "remove_node", nodeId: nodeOf("approval.owner").id }],
    });

    expect(result.status).toBe("failed");
    expect(result.summary).toMatch(/has to wait for you/i);
    expect(saveDocument).not.toHaveBeenCalled();
  });

  it("offers the owner something it can actually do instead", async () => {
    storeAt(6, [record()]);
    const result = await applyWorkflowEdit(db, workspace, {
      workflowId: salonReceptionWorkflow.id,
      expectedVersion: 6,
      operations: [{ op: "remove_node", nodeId: nodeOf("approval.owner").id }],
    });
    expect(result.summary).toMatch(/cover fewer things|move it/i);
  });

  it("still allows ordinary unfinished editing", async () => {
    // Refusing every invalid state would make the Copilot useless: a
    // half-built workflow is normal. Only stripping a required approval is
    // refused.
    storeAt(6, [record()]);
    const result = await applyWorkflowEdit(db, workspace, {
      workflowId: salonReceptionWorkflow.id,
      expectedVersion: 6,
      operations: [{ op: "remove_node", nodeId: nodeOf("trigger.website").id }],
    });

    expect(result.status).not.toBe("failed");
    expect(result.summary).toMatch(/not valid yet/i);
    expect(saveDocument).toHaveBeenCalledOnce();
  });
});

describe("publishing from chat", () => {
  it("refuses a workflow that does not validate", async () => {
    const broken = record();
    broken.workflow = {
      ...broken.workflow,
      nodes: broken.workflow.nodes.filter(
        (node) => !node.kind.startsWith("trigger."),
      ),
    };
    storeAt(6, [broken]);

    const result = await copilotPublishWorkflow(db, workspace, {
      workflowId: salonReceptionWorkflow.id,
      expectedVersion: 6,
    });
    expect(result.status).toBe("failed");
    expect(saveDocument).not.toHaveBeenCalled();
  });

  it("says which version now governs, and offers to take it back", async () => {
    storeAt(6, [record()]);
    const result = await copilotPublishWorkflow(db, workspace, {
      workflowId: salonReceptionWorkflow.id,
      expectedVersion: 6,
    });

    expect(result.status).toBe("applied");
    expect(result.summary).toMatch(/v1/);
    expect(result.summary).toMatch(/governs website/i);
    expect(result.undo).toBeTruthy();
  });
});

describe("undoing a workflow action", () => {
  it("archives a workflow it published, so it stops governing", async () => {
    const live = publishWorkflowVersion(record());
    storeAt(6, [live]);

    const result = await undoWorkflowChange(
      db,
      workspace,
      JSON.stringify({ k: "workflows", archive: salonReceptionWorkflow.id }),
    );
    expect(result.status).toBe("applied");
    expect(result.summary).toMatch(/no longer governs/i);
  });

  it("will not remove a draft that has since been published", async () => {
    // An undo button is a convenience, not an authority over live config.
    const live = publishWorkflowVersion(record());
    storeAt(6, [live]);

    const result = await undoWorkflowChange(
      db,
      workspace,
      JSON.stringify({ k: "workflows", remove: salonReceptionWorkflow.id }),
    );
    expect(result.status).toBe("failed");
    expect(saveDocument).not.toHaveBeenCalled();
  });

  it("refuses a token for a different store", async () => {
    storeAt(6, [record()]);
    const result = await undoWorkflowChange(
      db,
      workspace,
      JSON.stringify({ k: "knowledge", remove: "x" }),
    );
    expect(result.status).toBe("failed");
  });
});
