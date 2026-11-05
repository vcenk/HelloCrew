"use server";

import { z } from "zod";

import {
  copilotContextSchema,
  roleAllows,
  type ActionProposal,
  type ActionResult,
  type CopilotContext,
  type PendingAction,
} from "@/lib/copilot/contracts";
import { findCopilotAction } from "@/lib/copilot/registry";
import { decideCopilotAction } from "@/lib/copilot/policy";
import type { WorkflowOperation } from "@/lib/copilot/workflow-ops";
import { getWorkspaceContext, type WorkspaceContext } from "@/lib/data/workspace";
import { knowledgeKinds } from "@/lib/knowledge";
import { recordCopilotAudit } from "@/lib/server/copilot/audit";
import {
  applyKnowledgeFromDocument,
  approveKnowledgeSources,
  copilotSearchKnowledge,
  planKnowledgeFromDocument,
  undoKnowledgeChange,
} from "@/lib/server/copilot/knowledge";
import {
  applyWorkflowEdit,
  copilotCreateWorkflowDraft,
  copilotDeleteWorkflow,
  copilotInspectWorkflow,
  copilotPublishWorkflow,
  copilotRestoreWorkflowVersion,
  copilotTestWorkflow,
  undoWorkflowChange,
} from "@/lib/server/copilot/workflow";
import { decideOwnerIntent } from "@/lib/server/copilot/run";
import { readLiveConfig } from "@/lib/server/live-config";
import { listConnectionsFor } from "@/lib/server/connections";
import { widgetAdminClient } from "@/lib/server/widget-installations";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { processKnowledgeFile } from "./knowledge-file-actions";

/**
 * The only way the Copilot panel reaches the server.
 *
 * Next.js server actions answer direct POSTs, not just this app's own UI, so
 * every export here resolves the session itself and checks the role against
 * the registered action. Nothing trusts the panel, the route it came from, or
 * anything the model returned.
 */

type Failure = {
  ok: false;
  reason: "signed_out" | "forbidden" | "invalid" | "unavailable" | "error";
  error: string;
};
type Result<T> = ({ ok: true } & T) | Failure;

const failure = (reason: Failure["reason"], error: string): Failure => ({
  ok: false,
  reason,
  error,
});

type Session = { db: Awaited<ReturnType<typeof createClient>>; workspace: WorkspaceContext };

async function session(): Promise<Session | null> {
  if (!isSupabaseConfigured()) return null;
  const db = await createClient();
  const workspace = await getWorkspaceContext(db);
  return workspace ? { db, workspace } : null;
}

/**
 * Resolves the session and checks this specific action's required role.
 *
 * The role comes from the verified session every time. A panel that thinks it
 * is an owner, or a route that looks like an admin page, changes nothing.
 */
async function authorized<T>(
  actionName: string,
  body: (s: Session, action: NonNullable<ReturnType<typeof findCopilotAction>>) => Promise<Result<T>>,
): Promise<Result<T>> {
  const action = findCopilotAction(actionName);
  // Not a registered action: there is nothing to authorize.
  if (!action) return failure("invalid", "That isn't something I can do.");
  try {
    const s = await session();
    if (!s) return failure("signed_out", "Sign in to use the Copilot.");
    if (!roleAllows(s.workspace.role, action.requiredRole)) {
      recordCopilotAudit(s.workspace, action, "refused", { reason: "forbidden" });
      return failure(
        "forbidden",
        s.workspace.role === "viewer"
          ? "Viewers can look but not change anything."
          : "That needs an owner.",
      );
    }
    return await body(s, action);
  } catch (error) {
    return failure("error", error instanceof Error ? error.message : "Something went wrong.");
  }
}

/** Integrations this workspace has connected, for actions that need one. */
async function connectedIntegrations(workspace: WorkspaceContext) {
  const admin = widgetAdminClient();
  if (!admin) return new Set<string>();
  const calendars = await listConnectionsFor(admin, workspace.tenantId, "google_calendar").catch(
    () => [],
  );
  return new Set(
    calendars.some((connection) => connection.status === "connected")
      ? ["google_calendar"]
      : [],
  );
}

const suggestionSchema = z.object({
  kind: z.enum(knowledgeKinds),
  title: z.string().min(1).max(180),
  content: z.string().min(1).max(12_000),
  price: z.string().max(100).optional(),
  options: z
    .array(
      z.object({
        who: z.string().max(80),
        price: z.string().max(60),
        duration: z.string().max(40).optional(),
      }),
    )
    .max(12)
    .optional(),
});

const fileSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["file", "url"]),
  fileName: z.string().max(240).nullable(),
  title: z.string().min(1).max(180),
});

const turnSchema = z.object({
  text: z.string().trim().min(1).max(4_000),
  context: copilotContextSchema,
  /** The file the owner attached to this message, if any. */
  fileId: z.string().uuid().optional(),
  fileName: z.string().max(240).optional(),
  /**
   * Recent turns from the panel. The owner's own words and this Copilot's own
   * replies, so nothing here grants anything — every action is still checked
   * against the session and the registry.
   */
  history: z
    .array(
      z.object({
        role: z.enum(["owner", "copilot"]),
        text: z.string().max(2_000),
      }),
    )
    .max(12)
    .default([]),
  /**
   * The workspace document versions this browser is holding.
   *
   * Reported by the page, because the page is the thing that has actually
   * shown the owner a copy. It can only cause an edit to be refused, never to
   * be allowed: the compare-and-swap in the store is what makes a write safe,
   * and it runs whatever arrives here.
   */
  seen: z
    .object({ workflows: z.number().int().min(0).optional() })
    .default({}),
});

export type CopilotTurnResult = {
  /** Shown as the Copilot's message. */
  reply: string;
  /** Present when there is something to decide on. */
  proposal?: ActionProposal;
  /** Present when the action needs a person to say yes before it runs. */
  pending?: PendingAction;
  /** Present when the action ran immediately, as read_only ones do. */
  result?: ActionResult;
  /** Carried back so applying does not pay to read the document twice. */
  source?: { file: z.infer<typeof fileSchema>; suggestions: z.infer<typeof suggestionSchema>[] };
};

/**
 * What the owner is asked before an action that needs their word.
 *
 * Built from the workspace's own data rather than the model's wording, so
 * the question names the real workflow and the real consequence.
 */
async function confirmationFor(
  s: Session,
  actionName: string,
  input: unknown,
): Promise<
  { ok: true; pending: PendingAction } | { ok: false; failure: Failure }
> {
  const action = findCopilotAction(actionName);
  if (!action) return { ok: false, failure: failure("invalid", "That isn't something I can do.") };
  const parsed = action.input.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      failure: failure("invalid", "I understood what you want but not the details."),
    };

  const base = { action: actionName, safety: action.safety, input: parsed.data };
  if (actionName === "workflow_publish" || actionName === "workflow_delete") {
    const { workflowId } = parsed.data as { workflowId: string };
    const looked = await copilotInspectWorkflow(s.db, s.workspace, workflowId);
    const named = looked.summary.match(/^“([^”]+)”/)?.[1] ?? "that workflow";
    return {
      ok: true,
      pending:
        actionName === "workflow_publish"
          ? {
              ...base,
              question: `Publish “${named}” so it starts governing live conversations?`,
              consequence: looked.summary,
              confirmLabel: "Publish it",
            }
          : {
              ...base,
              question: `Delete “${named}” for good?`,
              consequence:
                "Its published versions go with it and nothing brings them back.",
              confirmLabel: "Delete it",
            },
    };
  }

  return {
    ok: true,
    pending: {
      ...base,
      question: `Go ahead with ${actionName.replace(/_/g, " ")}?`,
      confirmLabel: "Yes, do it",
    },
  };
}

const confirmSchema = z.object({
  action: z.string().min(1).max(80),
  input: z.unknown(),
  seen: z.object({ workflows: z.number().int().min(0).optional() }).default({}),
});

/**
 * Runs an action the owner has just confirmed.
 *
 * Nothing here trusts the round trip. The session is resolved again, the
 * name is looked up in the registry again, the role is checked against
 * that action again, and the arguments are re-parsed against its own
 * schema — so a crafted POST can do no more than the owner could.
 */
export async function confirmCopilotAction(
  raw: unknown,
): Promise<Result<{ result: ActionResult }>> {
  const parsed = confirmSchema.safeParse(raw);
  if (!parsed.success) return failure("invalid", "That action is no longer valid.");

  return authorized(parsed.data.action, async (auth, action) => {
    const args = action.input.safeParse(parsed.data.input);
    if (!args.success) return failure("invalid", "Those details didn't check out.");
    const expectedVersion = parsed.data.seen.workflows ?? null;

    let result: ActionResult;
    if (action.name === "workflow_publish")
      result = await copilotPublishWorkflow(auth.db, auth.workspace, {
        ...(args.data as { workflowId: string }),
        expectedVersion,
      });
    else if (action.name === "workflow_delete")
      result = await copilotDeleteWorkflow(auth.db, auth.workspace, {
        ...(args.data as { workflowId: string }),
        expectedVersion,
      });
    else return failure("invalid", "That action can't be confirmed this way.");

    recordCopilotAudit(
      auth.workspace,
      action,
      result.status === "applied" ? "applied" : "failed",
      { applied: result.applied },
    );
    return { ok: true, result };
  });
}

/**
 * One turn: work out what the owner wants and go as far as the safety level
 * allows without asking. Reads run. Anything that writes comes back as a
 * proposal for them to look at.
 */
export async function copilotTurn(input: unknown): Promise<Result<CopilotTurnResult>> {
  const parsed = turnSchema.safeParse(input);
  if (!parsed.success) return failure("invalid", "I didn't catch that.");

  const s = await session();
  if (!s) return failure("signed_out", "Sign in to use the Copilot.");

  const live = readLiveConfig();
  if (!live.ready)
    return failure("unavailable", "The Copilot needs the OpenAI key set on the server.");

  const connected = await connectedIntegrations(s.workspace);
  const intent = await decideOwnerIntent({
    config: live.config,
    text: parsed.data.text,
    context: parsed.data.context as CopilotContext,
    role: s.workspace.role,
    connected,
    history: parsed.data.history,
    attachment: parsed.data.fileId
      ? {
          fileId: parsed.data.fileId,
          name: parsed.data.fileName ?? "the attached document",
        }
      : null,
  });

  if (intent.kind === "reply") return { ok: true, reply: intent.text };
  if (intent.kind === "refused") return { ok: true, reply: intent.text };

  // The single confirmation gate. Anything whose declared safety level
  // needs a person stops here, before any execution branch below can run
  // it. Previously the level was computed and nothing read it, so
  // publishing a workflow — which decides what customers are offered —
  // went straight through on the model's say-so.
  const gate = decideCopilotAction({
    name: intent.action,
    role: s.workspace.role,
    connected,
  });
  if (gate.allowed && gate.confirm) {
    const ask = await confirmationFor(s, intent.action, intent.input);
    if (!ask.ok) return ask.failure;
    return {
      ok: true,
      reply: ask.pending.question,
      pending: ask.pending,
    };
  }

  if (intent.action === "knowledge_search") {
    const { query } = intent.input as { query: string };
    return authorized(intent.action, async (auth, action) => {
      const result = await copilotSearchKnowledge(auth.db, auth.workspace, query);
      recordCopilotAudit(auth.workspace, action, "applied");
      return { ok: true, reply: result.summary, result };
    });
  }

  if (intent.action === "knowledge_add_from_document") {
    const fileId = parsed.data.fileId ?? (intent.input as { fileId?: string }).fileId;
    if (!fileId)
      return {
        ok: true,
        reply: "Attach the document you'd like me to read and ask again.",
      };

    return authorized(intent.action, async (auth, action) => {
      // The existing pipeline: download, size and type checks, extraction,
      // search indexing and suggestions, all already authorized and budgeted.
      const read = await processKnowledgeFile(fileId);
      if (!("ok" in read) || !read.ok) {
        recordCopilotAudit(auth.workspace, action, "failed");
        return failure("error", "error" in read ? read.error : "That file couldn't be read.");
      }

      const file = {
        id: read.file.id,
        kind: read.file.kind,
        fileName: read.file.fileName,
        title: read.file.title,
      };
      const planned = await planKnowledgeFromDocument(auth.db, auth.workspace, {
        proposalId: fileId,
        file,
        suggestions: read.suggestions,
        note: read.note,
      });
      if (!planned) return failure("error", "Your knowledge could not be read.");

      recordCopilotAudit(auth.workspace, action, "draft", {
        applied: 0,
        skipped: planned.plan.changes.operations.length,
      });

      const proposal: ActionProposal = {
        id: fileId,
        action: action.name,
        safety: action.safety,
        changes: planned.plan.changes,
      };
      return {
        ok: true,
        reply: planned.plan.changes.summary,
        proposal,
        source: { file, suggestions: read.suggestions },
      };
    });
  }

  if (intent.action === "workflow_inspect") {
    const { workflowId } = intent.input as { workflowId?: string };
    return authorized(intent.action, async (auth, action) => {
      const result = await copilotInspectWorkflow(auth.db, auth.workspace, workflowId);
      recordCopilotAudit(auth.workspace, action, "applied");
      return { ok: true, reply: result.summary, result };
    });
  }

  if (intent.action === "workflow_test_draft") {
    const { workflowId } = intent.input as { workflowId: string };
    return authorized(intent.action, async (auth, action) => {
      const result = await copilotTestWorkflow(auth.db, auth.workspace, workflowId);
      recordCopilotAudit(auth.workspace, action, "applied");
      return { ok: true, reply: result.summary, result };
    });
  }

  if (intent.action === "workflow_create_draft") {
    const create = intent.input as { templateId?: string; name?: string };
    return authorized(intent.action, async (auth, action) => {
      const result = await copilotCreateWorkflowDraft(auth.db, auth.workspace, create);
      recordCopilotAudit(
        auth.workspace,
        action,
        result.status === "failed" ? "failed" : "draft",
        { applied: result.applied },
      );
      return { ok: true, reply: result.summary, result };
    });
  }

  if (intent.action === "workflow_update_draft") {
    const edit = intent.input as {
      workflowId: string;
      operations: WorkflowOperation[];
    };
    return authorized(intent.action, async (auth, action) => {
      const result = await applyWorkflowEdit(auth.db, auth.workspace, {
        ...edit,
        expectedVersion: parsed.data.seen.workflows ?? null,
      });
      recordCopilotAudit(
        auth.workspace,
        action,
        result.status === "failed" ? "failed" : "draft",
        { applied: result.applied, skipped: result.skipped },
      );
      return { ok: true, reply: result.summary, result };
    });
  }

  if (intent.action === "workflow_restore_version") {
    const restore = intent.input as { workflowId: string; version: number };
    return authorized(intent.action, async (auth, action) => {
      const result = await copilotRestoreWorkflowVersion(auth.db, auth.workspace, {
        ...restore,
        expectedVersion: parsed.data.seen.workflows ?? null,
      });
      recordCopilotAudit(
        auth.workspace,
        action,
        result.status === "failed" ? "failed" : "draft",
        { applied: result.applied },
      );
      return { ok: true, reply: result.summary, result };
    });
  }

  // workflow_publish and workflow_delete never reach here: the gate above
  // turns them into a question first.
  return { ok: true, reply: "I can't do that one yet." };
}

/** Puts back what a workflow action did, where rollback is real. */
export async function undoCopilotWorkflow(input: unknown): Promise<Result<{ result: ActionResult }>> {
  const parsed = undoSchema.safeParse(input);
  if (!parsed.success) return failure("invalid", "That undo is no longer valid.");

  return authorized("workflow_create_draft", async (auth, action) => {
    const result = await undoWorkflowChange(auth.db, auth.workspace, parsed.data.token);
    recordCopilotAudit(
      auth.workspace,
      action,
      result.status === "applied" ? "applied" : "failed",
      { applied: result.applied },
    );
    return { ok: true, result };
  });
}

const applySchema = z.object({
  proposalId: z.string().uuid(),
  file: fileSchema,
  /**
   * Echoed back from the proposal this server just produced. Accepted for the
   * same reason the Knowledge page accepts them: an operator can already type
   * any knowledge item by hand, and everything written here lands as a draft
   * nobody is using. It is re-validated and the store is re-planned server
   * side, so nothing is taken on trust beyond that.
   */
  suggestions: z.array(suggestionSchema).max(40),
  operationIds: z.array(z.string().min(1).max(120)).max(100),
  edits: z
    .record(
      z.string().max(120),
      z.object({
        title: z.string().max(180).optional(),
        content: z.string().max(12_000).optional(),
        price: z.string().max(100).optional(),
      }),
    )
    .optional(),
});

/** Writes the operations the owner kept, as drafts. */
export async function applyCopilotKnowledge(input: unknown): Promise<Result<{ result: ActionResult }>> {
  const parsed = applySchema.safeParse(input);
  if (!parsed.success) return failure("invalid", "Those changes couldn't be read.");

  return authorized("knowledge_add_from_document", async (auth, action) => {
    const result = await applyKnowledgeFromDocument(auth.db, auth.workspace, {
      proposalId: parsed.data.proposalId,
      file: parsed.data.file,
      suggestions: parsed.data.suggestions,
      operationIds: parsed.data.operationIds,
      edits: parsed.data.edits,
    });
    recordCopilotAudit(auth.workspace, action, result.status === "failed" ? "failed" : "draft", {
      applied: result.applied,
      skipped: result.skipped,
    });
    return { ok: true, result };
  });
}

const approveSchema = z.object({
  sourceIds: z.array(z.string().min(1).max(120)).min(1).max(100),
});

/** Lets the crew actually use specific drafts. Changes live behaviour. */
export async function approveCopilotKnowledge(input: unknown): Promise<Result<{ result: ActionResult }>> {
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) return failure("invalid", "Those items couldn't be read.");

  return authorized("knowledge_approve_items", async (auth, action) => {
    const result = await approveKnowledgeSources(auth.db, auth.workspace, parsed.data.sourceIds);
    recordCopilotAudit(auth.workspace, action, result.status === "applied" ? "applied" : "failed", {
      applied: result.applied,
      skipped: result.skipped,
    });
    return { ok: true, result };
  });
}

const undoSchema = z.object({ token: z.string().min(1).max(4_000) });

/** Puts back what an action did, where rollback is real. */
export async function undoCopilotKnowledge(input: unknown): Promise<Result<{ result: ActionResult }>> {
  const parsed = undoSchema.safeParse(input);
  if (!parsed.success) return failure("invalid", "That undo is no longer valid.");

  return authorized("knowledge_add_from_document", async (auth, action) => {
    const result = await undoKnowledgeChange(auth.db, auth.workspace, parsed.data.token);
    recordCopilotAudit(auth.workspace, action, result.status === "applied" ? "applied" : "failed", {
      applied: result.applied,
    });
    return { ok: true, result };
  });
}
