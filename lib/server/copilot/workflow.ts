import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ActionResult } from "@/lib/copilot/contracts";
import { buildWorkflowChangeSet } from "@/lib/copilot/workflow-changes";
import type { WorkflowOperation } from "@/lib/copilot/workflow-ops";
import { loadDocuments, saveDocument, type WorkspaceContext } from "@/lib/data/workspace";
import { validateWorkflow, workflowTemplates } from "@/lib/workflow";
import {
  createWorkflowRecord,
  parseWorkflowStore,
  publishWorkflowVersion,
  saveWorkflowDraft,
  setWorkflowArchived,
  WORKFLOW_STORAGE_VERSION,
  type WorkflowRecord,
  type WorkflowStore,
} from "@/lib/workflow-lifecycle";
import { compileWorkflowPolicy, latestPublished } from "@/lib/workflow-policy";
import { compilePracticePlan } from "@/lib/workflow-runner";

/**
 * The Copilot's workflow actions, executed.
 *
 * One store, shared with the canvas. The Copilot reads and writes the same
 * `workflows` workspace document the builder does, with the same
 * compare-and-swap, so a chat edit and a canvas edit cannot overwrite each
 * other — the second one to arrive is refused and told why, rather than
 * silently winning.
 */

const KEY = "workflows" as const;

type Loaded = { store: WorkflowStore; version: number };

async function loadStore(
  db: SupabaseClient,
  workspace: WorkspaceContext,
): Promise<Loaded> {
  const documents = await loadDocuments(db, workspace);
  const stored = documents[KEY];
  return {
    store: stored
      ? parseWorkflowStore(stored.document)
      : { formatVersion: WORKFLOW_STORAGE_VERSION, workflows: [] },
    version: stored?.version ?? 0,
  };
}

async function save(
  db: SupabaseClient,
  workspace: WorkspaceContext,
  loaded: Loaded,
  workflows: WorkflowRecord[],
): Promise<"saved" | "conflict" | "error"> {
  const outcome = await saveDocument(db, workspace, KEY, loaded.version, {
    ...loaded.store,
    workflows,
  });
  return outcome.ok ? "saved" : outcome.reason === "conflict" ? "conflict" : "error";
}

const staleMessage =
  "This workflow changed while you were looking at it — somebody may have it open on the canvas. Ask me to look again and I'll work from the latest.";

/**
 * Whether the copy the owner's browser is holding is still the current one.
 *
 * `seen` is the version that browser reported, or null when it had none to
 * report. Null is not a bypass: `saveDocument` below still writes against the
 * version this request just read, so a canvas save landing in between is
 * refused by the database either way. This check is the wider guard — it
 * catches a change made before the owner even asked.
 */
function movedOn(current: number, seen: number | null) {
  return seen !== null && seen !== current;
}

const failed = (summary: string): ActionResult => ({
  status: "failed",
  summary,
  applied: 0,
  skipped: 0,
  links: [],
});

const workflowLink = { label: "Open the workflow editor", href: "/app/workflows" };

/** read_only: what a workflow is and whether it does anything. */
export async function copilotInspectWorkflow(
  db: SupabaseClient,
  workspace: WorkspaceContext,
  workflowId?: string,
): Promise<ActionResult & { documentVersion: number }> {
  const loaded = await loadStore(db, workspace);
  const records = loaded.store.workflows;
  if (records.length === 0)
    return {
      ...failed("There are no workflows yet. I can start one from a template."),
      status: "applied",
      documentVersion: loaded.version,
    };

  const record =
    records.find((candidate) => candidate.workflow.id === workflowId) ?? records[0];
  const issues = validateWorkflow(record.workflow);
  const compiled = compileWorkflowPolicy(record);
  const published = latestPublished(record);

  const lines = [
    `“${record.workflow.name}” is ${record.lifecycle}, with ${record.workflow.nodes.length} steps.`,
    // The id is in the reply because an edit has to name the workflow and one
    // action runs per turn — without it the next turn has nothing to address.
    // No version here: that is the browser's to report, not the model's.
    `workflowId ${record.workflow.id}.`,
    `Steps: ${record.workflow.nodes
      .map((node) => `${node.id} (${node.label})`)
      .join(", ")}.`,
    published
      ? `Published version ${published.version}.`
      : "It has never been published, so it governs nothing.",
    issues.length === 0
      ? "It is valid."
      : `It is not valid: ${issues[0].message}`,
    compiled.ok
      ? `As published it governs ${compiled.policy.channel} conversations.`
      : `It does not govern conversations: ${compiled.reason}`,
  ];

  return {
    status: "applied",
    summary: lines.join(" "),
    applied: 0,
    skipped: 0,
    links: [workflowLink],
    documentVersion: loaded.version,
  };
}

/** draft_write: a new draft, optionally from a template. */
export async function copilotCreateWorkflowDraft(
  db: SupabaseClient,
  workspace: WorkspaceContext,
  input: { templateId?: string; name?: string },
): Promise<ActionResult> {
  const loaded = await loadStore(db, workspace);
  const template = input.templateId
    ? workflowTemplates.find((candidate) => candidate.id === input.templateId)
    : undefined;
  if (input.templateId && !template)
    return failed(
      `There is no template called “${input.templateId}”. The ones available are: ${workflowTemplates
        .map((candidate) => candidate.id)
        .join(", ")}.`,
    );

  const base = template?.workflow ?? workflowTemplates[0].workflow;
  const record = createWorkflowRecord(
    {
      ...structuredClone(base),
      id: crypto.randomUUID(),
      name: input.name ?? template?.name ?? base.name,
      version: 1,
      status: "draft",
    },
    { sourceTemplateId: template?.id },
  );

  const outcome = await save(db, workspace, loaded, [
    ...loaded.store.workflows,
    record,
  ]);
  if (outcome !== "saved")
    return failed(outcome === "conflict" ? staleMessage : "That draft could not be saved.");

  return {
    status: "draft",
    summary: `Created “${record.workflow.name}” as a draft. It governs nothing until you publish it.`,
    applied: 1,
    skipped: 0,
    links: [workflowLink],
    undo: {
      token: JSON.stringify({ k: KEY, remove: record.workflow.id }),
      action: "workflow_create_draft",
      expiresAt: Date.now() + 60 * 60 * 1000,
      describes: `the draft “${record.workflow.name}”`,
    },
  };
}

/** draft_write: what a set of edits would do, without saving them. */
export async function planWorkflowEdit(
  db: SupabaseClient,
  workspace: WorkspaceContext,
  input: { workflowId: string; operations: readonly WorkflowOperation[]; title: string },
) {
  const loaded = await loadStore(db, workspace);
  const record = loaded.store.workflows.find(
    (candidate) => candidate.workflow.id === input.workflowId,
  );
  if (!record) return null;
  return {
    plan: buildWorkflowChangeSet({
      id: input.workflowId,
      record,
      operations: input.operations,
      title: input.title,
    }),
    documentVersion: loaded.version,
  };
}

/** draft_write: save the edits, refusing if the draft moved underneath us. */
export async function applyWorkflowEdit(
  db: SupabaseClient,
  workspace: WorkspaceContext,
  input: {
    workflowId: string;
    expectedVersion: number | null;
    operations: readonly WorkflowOperation[];
  },
): Promise<ActionResult> {
  const loaded = await loadStore(db, workspace);
  // Checked before anything is computed: a draft that moved is one somebody
  // else is working on, and overwriting their edit is worse than refusing.
  if (movedOn(loaded.version, input.expectedVersion)) return failed(staleMessage);

  const record = loaded.store.workflows.find(
    (candidate) => candidate.workflow.id === input.workflowId,
  );
  if (!record) return failed("That workflow no longer exists.");

  const plan = buildWorkflowChangeSet({
    id: input.workflowId,
    record,
    operations: input.operations,
    title: record.workflow.name,
  });

  // Saving a draft that is merely unfinished is ordinary editing. Saving one
  // that has had a required approval taken off an external action is not: the
  // owner asked for something the product does not allow, and quietly writing
  // it down so publishing fails later would be obeying and hiding it.
  const before = new Set(
    validateWorkflow(record.workflow)
      .filter((issue) => issue.code === "approval_required")
      .map((issue) => issue.nodeId),
  );
  const stripped = validateWorkflow(plan.candidate).filter(
    (issue) => issue.code === "approval_required" && !before.has(issue.nodeId),
  );
  if (stripped.length > 0)
    return {
      ...failed(
        `I can't do that. ${stripped[0].message} Anything that books, cancels or replies on your behalf has to wait for you — that is not a setting. I can make the approval cover fewer things instead, or move it, if you tell me which.`,
      ),
      skipped: input.operations.length,
    };

  const updated = saveWorkflowDraft(record, plan.candidate);
  const outcome = await save(
    db,
    workspace,
    loaded,
    loaded.store.workflows.map((candidate) =>
      candidate.workflow.id === record.workflow.id ? updated : candidate,
    ),
  );
  if (outcome !== "saved")
    return failed(outcome === "conflict" ? staleMessage : "Those changes could not be saved.");

  const refused = plan.changes.operations.filter((operation) => !operation.selected);
  return {
    status: refused.length > 0 ? "partial" : "draft",
    summary: plan.valid
      ? `Saved to the draft of “${plan.candidate.name}”. It is still a draft — publishing is a separate step.`
      : `Saved to the draft, but it is not valid yet, so it cannot be published: ${plan.changes.notes[0] ?? ""}`,
    applied: plan.changes.operations.length - refused.length,
    skipped: refused.length,
    links: [workflowLink],
  };
}

/** read_only: what each step would do, with nothing written and nobody contacted. */
export async function copilotTestWorkflow(
  db: SupabaseClient,
  workspace: WorkspaceContext,
  workflowId: string,
): Promise<ActionResult> {
  const loaded = await loadStore(db, workspace);
  const record = loaded.store.workflows.find(
    (candidate) => candidate.workflow.id === workflowId,
  );
  if (!record) return failed("That workflow no longer exists.");

  try {
    const plan = compilePracticePlan(record.workflow);
    return {
      status: "applied",
      summary: `${plan.steps.length} steps, none of which contact anyone: ${plan.steps
        .map((step) => `${step.label} (${step.state.replace(/_/g, " ")})`)
        .join("; ")}.`,
      applied: 0,
      skipped: 0,
      links: [workflowLink],
    };
  } catch (error) {
    return failed(
      error instanceof Error ? error.message : "That workflow could not be tested.",
    );
  }
}

/** live_configuration: this is where a workflow starts governing customers. */
export async function copilotPublishWorkflow(
  db: SupabaseClient,
  workspace: WorkspaceContext,
  input: { workflowId: string; expectedVersion: number | null },
): Promise<ActionResult> {
  const loaded = await loadStore(db, workspace);
  if (movedOn(loaded.version, input.expectedVersion)) return failed(staleMessage);

  const record = loaded.store.workflows.find(
    (candidate) => candidate.workflow.id === input.workflowId,
  );
  if (!record) return failed("That workflow no longer exists.");

  let publishedRecord: WorkflowRecord;
  try {
    publishedRecord = publishWorkflowVersion(record);
  } catch (error) {
    return failed(
      error instanceof Error ? error.message : "That workflow could not be published.",
    );
  }

  const outcome = await save(
    db,
    workspace,
    loaded,
    loaded.store.workflows.map((candidate) =>
      candidate.workflow.id === record.workflow.id ? publishedRecord : candidate,
    ),
  );
  if (outcome !== "saved")
    return failed(outcome === "conflict" ? staleMessage : "That could not be published.");

  const compiled = compileWorkflowPolicy(publishedRecord);
  const version = latestPublished(publishedRecord)?.version ?? 0;
  return {
    status: "applied",
    summary: compiled.ok
      ? `Published “${publishedRecord.workflow.name}” v${version}. It now governs ${compiled.policy.channel} conversations.`
      : `Published “${publishedRecord.workflow.name}” v${version}, but it governs no conversations: ${compiled.reason}`,
    applied: 1,
    skipped: 0,
    links: [workflowLink],
    undo: {
      token: JSON.stringify({ k: KEY, archive: record.workflow.id }),
      action: "workflow_publish",
      expiresAt: Date.now() + 60 * 60 * 1000,
      describes: `publishing “${publishedRecord.workflow.name}” v${version}`,
    },
  };
}

/** Puts back what a workflow action did, where that is genuinely possible. */
export async function undoWorkflowChange(
  db: SupabaseClient,
  workspace: WorkspaceContext,
  token: string,
): Promise<ActionResult> {
  let parsed: { k?: string; remove?: string; archive?: string };
  try {
    parsed = JSON.parse(token) as typeof parsed;
  } catch {
    return failed("That undo is no longer valid.");
  }
  if (parsed.k !== KEY) return failed("That undo is no longer valid.");

  const loaded = await loadStore(db, workspace);
  let workflows = loaded.store.workflows;
  let describes = "";

  if (parsed.remove) {
    const target = workflows.find(
      (candidate) =>
        candidate.workflow.id === parsed.remove &&
        // Only a draft nobody published. Removing a published workflow is a
        // different decision, and not one an undo button should make.
        candidate.lifecycle === "draft",
    );
    if (!target) return failed("Nothing to undo — that draft has already changed.");
    workflows = workflows.filter(
      (candidate) => candidate.workflow.id !== parsed.remove,
    );
    describes = `Removed the draft “${target.workflow.name}”.`;
  } else if (parsed.archive) {
    const target = workflows.find(
      (candidate) => candidate.workflow.id === parsed.archive,
    );
    if (!target || target.lifecycle !== "published")
      return failed("Nothing to undo — that workflow has already changed.");
    workflows = workflows.map((candidate) =>
      candidate.workflow.id === parsed.archive
        ? setWorkflowArchived(candidate, true)
        : candidate,
    );
    describes = `Archived “${target.workflow.name}”, so it no longer governs conversations.`;
  } else {
    return failed("That undo is no longer valid.");
  }

  const outcome = await save(db, workspace, loaded, workflows);
  if (outcome !== "saved")
    return failed(outcome === "conflict" ? staleMessage : "That could not be undone.");

  return {
    status: "applied",
    summary: describes,
    applied: 1,
    skipped: 0,
    links: [workflowLink],
  };
}
