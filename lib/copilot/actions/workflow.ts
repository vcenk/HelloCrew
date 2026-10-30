import { z } from "zod";

import type { CopilotActionMeta } from "../contracts";
import { workflowOperationSchema } from "../workflow-ops";
import { workflowTemplates } from "@/lib/workflow";

/**
 * What the Copilot may do with workflows.
 *
 * Drafting and publishing are separate actions, not one action with a
 * "publish" flag. A flag would mean the safety level depended on an argument
 * the model chose, and the model would be choosing whether a person has to
 * agree before its edits start governing real conversations.
 */

export const inspectWorkflow: CopilotActionMeta<
  z.ZodObject<{ workflowId: z.ZodOptional<z.ZodString> }>
> = {
  name: "workflow_inspect",
  description:
    "Describe a workflow: its trigger, its steps, whether it is valid, whether it is published, and what it would change about the crew. Use before proposing an edit.",
  input: z.object({ workflowId: z.string().max(80).optional() }),
  safety: "read_only",
  requiredRole: "viewer",
  resource: "workflow",
  requires: null,
  affectsLiveBehaviour: false,
  supportsUndo: false,
  audit: { event: "copilot.workflow.inspected", recordsPii: false },
};

export const createWorkflowDraft: CopilotActionMeta<
  z.ZodObject<{
    templateId: z.ZodOptional<z.ZodEnum<Record<string, string>>>;
    name: z.ZodOptional<z.ZodString>;
  }>
> = {
  name: "workflow_create_draft",
  // The ids are listed rather than described, because a model asked for "the
  // salon template" will otherwise invent "salon" and be refused for it.
  description: `Start a new workflow draft, optionally from a ready-made template. The draft is not published and governs nothing. Templates: ${workflowTemplates
    .map((template) => `${template.id} (${template.name})`)
    .join(", ")}.`,
  input: z.object({
    templateId: z
      .enum(
        workflowTemplates.map((template) => template.id) as [string, ...string[]],
      )
      .optional(),
    name: z.string().trim().min(1).max(80).optional(),
  }),
  safety: "draft_write",
  requiredRole: "operator",
  resource: "workflow",
  requires: null,
  // A draft is not published, so by definition it governs no conversation.
  affectsLiveBehaviour: false,
  supportsUndo: true,
  audit: { event: "copilot.workflow.drafted", recordsPii: false },
};

export const updateWorkflowDraft: CopilotActionMeta<
  z.ZodObject<{
    workflowId: z.ZodString;
    expectedVersion: z.ZodNumber;
    operations: z.ZodArray<typeof workflowOperationSchema>;
  }>
> = {
  name: "workflow_update_draft",
  description:
    "Change a workflow draft by naming specific operations. Only edits the draft; it does not publish.",
  input: z.object({
    workflowId: z.string().min(1).max(80),
    /**
     * The version the owner was looking at. A draft that moved since then is
     * refused rather than overwritten — somebody may be editing it on the
     * canvas right now.
     */
    expectedVersion: z.number().int().min(0),
    operations: z.array(workflowOperationSchema).min(1).max(20),
  }),
  safety: "draft_write",
  requiredRole: "operator",
  resource: "workflow",
  requires: null,
  affectsLiveBehaviour: false,
  supportsUndo: true,
  audit: { event: "copilot.workflow.edited", recordsPii: false },
};

export const testWorkflowDraft: CopilotActionMeta<
  z.ZodObject<{ workflowId: z.ZodString }>
> = {
  name: "workflow_test_draft",
  description:
    "Run a workflow draft as a practice plan and report what each step would do. Writes nothing and contacts nobody.",
  input: z.object({ workflowId: z.string().min(1).max(80) }),
  safety: "read_only",
  requiredRole: "viewer",
  resource: "workflow",
  requires: null,
  affectsLiveBehaviour: false,
  supportsUndo: false,
  audit: { event: "copilot.workflow.tested", recordsPii: false },
};

export const publishWorkflow: CopilotActionMeta<
  z.ZodObject<{ workflowId: z.ZodString; expectedVersion: z.ZodNumber }>
> = {
  name: "workflow_publish",
  description:
    "Publish a workflow draft so it starts governing live conversations. Only ever at the owner's explicit instruction.",
  input: z.object({
    workflowId: z.string().min(1).max(80),
    expectedVersion: z.number().int().min(0),
  }),
  safety: "live_configuration",
  requiredRole: "operator",
  resource: "workflow",
  requires: null,
  // This is the step where a published workflow starts deciding what a
  // customer can be offered.
  affectsLiveBehaviour: true,
  // Archiving it again is a real rollback of the governing it does.
  supportsUndo: true,
  audit: { event: "copilot.workflow.published", recordsPii: false },
};

export const workflowActions = [
  inspectWorkflow,
  createWorkflowDraft,
  updateWorkflowDraft,
  testWorkflowDraft,
  publishWorkflow,
] as const;
