import { z } from "zod";

import type { WorkspaceRole } from "@/lib/data/workspace";

/**
 * The canonical contracts between the owner's Copilot panel, the server
 * orchestration and the actions it may run.
 *
 * Client-safe on purpose: the panel imports these to render, and nothing here
 * reaches a database or a model. Execution lives in lib/server/copilot.
 */

/**
 * What an action is allowed to do, and therefore what gate it passes through.
 *
 * Declared by the action, read on the server, and never taken from model
 * output — a model that could name its own safety level could name the
 * harmless one.
 */
export const safetyLevels = [
  /** Search, summarise, explain, navigate. Runs immediately. */
  "read_only",
  /** Creates drafts and suggestions. Runs immediately, visibly a draft. */
  "draft_write",
  /** Changes what the live crew does. Needs before/after and confirmation. */
  "live_configuration",
  /** Reaches outside HelloCrew: a message, a booking. Needs confirmation. */
  "external_write",
  /** Removes something durable. Names the target, needs confirmation. */
  "destructive",
] as const;
export type SafetyLevel = (typeof safetyLevels)[number];

/** Levels that may run the moment the owner asks. */
const IMMEDIATE: ReadonlySet<SafetyLevel> = new Set<SafetyLevel>([
  "read_only",
  "draft_write",
]);

export function needsConfirmation(level: SafetyLevel): boolean {
  return !IMMEDIATE.has(level);
}

/** What a change is about, so the panel can link to the right screen. */
export const resourceTypes = [
  "knowledge",
  "knowledge_file",
  "workflow",
  "crew",
  "working_hours",
  "connection",
  "conversation",
] as const;
export type ResourceType = (typeof resourceTypes)[number];

/** Where in the dashboard the owner is. A hint for the model, never authority. */
export const copilotContextSchema = z.object({
  route: z.string().max(200),
  /** The thing being looked at, if the route has one. */
  entity: z
    .object({ type: z.enum(resourceTypes), id: z.string().max(120) })
    .optional(),
  /** Rendered as the panel's context chip, e.g. "Receptionist · Knowledge". */
  label: z.string().max(80).optional(),
});
export type CopilotContext = z.infer<typeof copilotContextSchema>;

export const copilotAttachmentSchema = z.object({
  /** The row in hc_knowledge_files this came from. */
  fileId: z.string().uuid(),
  name: z.string().min(1).max(240),
  sizeBytes: z.number().int().min(0),
});
export type CopilotAttachment = z.infer<typeof copilotAttachmentSchema>;

export const copilotMessageSchema = z.object({
  id: z.string().min(1).max(120),
  role: z.enum(["owner", "copilot"]),
  text: z.string().max(8_000),
  at: z.number().int(),
  attachments: z.array(copilotAttachmentSchema).max(5).optional(),
  /** Set when this message carries something to decide on. */
  proposalId: z.string().max(120).optional(),
});
export type CopilotMessage = z.infer<typeof copilotMessageSchema>;

/** One turn of the owner talking to the Copilot. */
export const ownerCommandSchema = z.object({
  text: z.string().trim().min(1).max(4_000),
  context: copilotContextSchema,
  attachments: z.array(copilotAttachmentSchema).max(5).default([]),
});
export type OwnerCommand = z.infer<typeof ownerCommandSchema>;

/**
 * A single thing that would change, in the owner's terms.
 *
 * `before` and `after` are already-rendered strings rather than raw records:
 * the panel shows a human a diff, and shipping raw rows to the client is both
 * a leak risk and unreadable.
 */
export const changeOperationSchema = z.object({
  id: z.string().min(1).max(120),
  kind: z.enum(["add", "update", "remove"]),
  resource: z.enum(resourceTypes),
  /** What it is, e.g. "Colour — long hair". */
  title: z.string().min(1).max(200),
  summary: z.string().max(400),
  before: z.string().max(2_000).optional(),
  after: z.string().max(2_000).optional(),
  /**
   * Why this needs a human eye: it disagrees with something already approved.
   * A conflicting operation starts deselected.
   */
  conflict: z
    .object({
      withTitle: z.string().max(200),
      explanation: z.string().max(400),
    })
    .optional(),
  /** Already present and identical, so applying it would do nothing. */
  duplicate: z.boolean().default(false),
  /** Whether this operation is currently chosen to apply. */
  selected: z.boolean().default(true),
});
export type ChangeOperation = z.infer<typeof changeOperationSchema>;

export const changeSetSchema = z.object({
  id: z.string().min(1).max(120),
  /** The action that produced it, for the audit trail and for applying it. */
  action: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  /** Plain-language account of what the Copilot understood. */
  summary: z.string().max(1_000),
  operations: z.array(changeOperationSchema).max(100),
  /** Named so the owner knows who is affected, e.g. ["Receptionist"]. */
  affectsCrew: z.array(z.string().max(60)).max(10).default([]),
  /**
   * False when applying this changes nothing the live crew does. Workflows are
   * the case that matters today: they are not compiled into runtime
   * configuration, so the panel must say so rather than imply otherwise.
   */
  affectsLiveBehaviour: z.boolean(),
  /** Anything in the source that could not be read safely. */
  notes: z.array(z.string().max(300)).max(20).default([]),
});
export type ChangeSet = z.infer<typeof changeSetSchema>;

/** What the Copilot offers to do, before anyone has said yes. */
export const actionProposalSchema = z.object({
  id: z.string().min(1).max(120),
  action: z.string().min(1).max(80),
  safety: z.enum(safetyLevels),
  changes: changeSetSchema,
  /** Present exactly when the level requires an explicit yes. */
  confirmation: z
    .object({
      question: z.string().min(1).max(300),
      confirmLabel: z.string().min(1).max(40),
      /** Spelled out for destructive and external work. */
      consequence: z.string().max(400).optional(),
    })
    .optional(),
});
export type ActionProposal = z.infer<typeof actionProposalSchema>;

/** The owner's decision, carrying which operations they kept. */
export const confirmationRequestSchema = z.object({
  proposalId: z.string().min(1).max(120),
  decision: z.enum(["approve", "reject"]),
  /** Operation ids to apply. Absent means every selected one. */
  operationIds: z.array(z.string().max(120)).max(100).optional(),
  /** Owner edits, keyed by operation id. */
  edits: z
    .record(
      z.string().max(120),
      z.object({
        title: z.string().max(200).optional(),
        content: z.string().max(12_000).optional(),
        price: z.string().max(100).optional(),
      }),
    )
    .optional(),
});
export type ConfirmationRequest = z.infer<typeof confirmationRequestSchema>;

/**
 * Only minted where rollback genuinely exists. Nothing issues one of these to
 * make an irreversible action feel safer.
 */
export const undoTokenSchema = z.object({
  token: z.string().min(1).max(200),
  action: z.string().min(1).max(80),
  expiresAt: z.number().int(),
  describes: z.string().max(200),
});
export type UndoToken = z.infer<typeof undoTokenSchema>;

export const actionResultSchema = z.object({
  status: z.enum(["applied", "partial", "rejected", "failed", "draft"]),
  /** What actually happened, in the owner's terms. */
  summary: z.string().max(1_000),
  applied: z.number().int().min(0).default(0),
  skipped: z.number().int().min(0).default(0),
  /** Where to go and look, e.g. { label: "Knowledge", href: "/app/knowledge" }. */
  links: z
    .array(
      z.object({
        label: z.string().min(1).max(80),
        href: z.string().min(1).max(300),
      }),
    )
    .max(5)
    .default([]),
  undo: undoTokenSchema.optional(),
  error: z.string().max(400).optional(),
});
export type ActionResult = z.infer<typeof actionResultSchema>;

/** Everything a registered action declares about itself, minus its code. */
export type CopilotActionMeta<Schema extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string;
  description: string;
  input: Schema;
  safety: SafetyLevel;
  /** Checked server-side against the session, never against the panel. */
  requiredRole: WorkspaceRole;
  resource: ResourceType;
  /** An integration that must be connected, e.g. "google_calendar". */
  requires: string | null;
  /** False when applying it cannot change what the live crew does. */
  affectsLiveBehaviour: boolean;
  supportsUndo: boolean;
  audit: { event: string; recordsPii: boolean };
};

const ROLE_RANK: Record<WorkspaceRole, number> = {
  viewer: 0,
  operator: 1,
  owner: 2,
};

/** Whether a session's role is enough for an action. */
export function roleAllows(role: WorkspaceRole, required: WorkspaceRole) {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}
