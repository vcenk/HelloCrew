import type { IntegrationId } from "@/lib/agent/tool-contract";
import type { WorkflowRecord } from "./workflow-lifecycle";
import { validateWorkflow, type WorkflowDefinition, type WorkflowKind } from "./workflow";

/**
 * Turns a published workflow into runtime policy.
 *
 * Deterministic, and narrowing only. The compiler says which of the tools the
 * server already offers this workflow permits; it cannot name a tool the
 * registry does not have, enable a skill the business switched off, or reach
 * an integration nobody connected. Those are decided before this runs and the
 * policy is applied after them, so "a workflow may narrow but never grant" is
 * a property of where it sits rather than a rule to remember.
 */

/** Conversation channels a workflow trigger can match. */
export type WorkflowChannel = "website";

/** Which trigger governs which conversations. */
const TRIGGER_CHANNEL: Partial<Record<WorkflowKind, WorkflowChannel>> = {
  "trigger.website": "website",
};

/**
 * The node kinds that reach the live agent, and what each governs.
 *
 * A node kind absent from here is not silently ignored: it raises a warning,
 * so a workflow drawn out of parts that do nothing says so.
 */
const GOVERNS: Partial<Record<WorkflowKind, readonly string[]>> = {
  "knowledge.search": ["search_knowledge"],
  "action.booking": [
    "request_booking",
    "propose_booking",
    "check_availability",
    "cancel_booking",
    "reschedule_booking",
  ],
  "handoff.inbox": ["handoff_to_human"],
};

/** Present for structure, with no runtime meaning of their own. */
const STRUCTURAL: readonly WorkflowKind[] = [
  "trigger.website",
  "ai.respond",
  "output.reply",
  "approval.owner",
];

/** Belongs to the reviews path, which is a scheduled sync, not live chat. */
const REVIEWS_ONLY: readonly WorkflowKind[] = [
  "trigger.google_review",
  "action.google_review_reply",
  "logic.review_risk",
  "handoff.review_follow_up",
  "output.review_complete",
];

export type WorkflowRuntimePolicy = {
  workflowId: string;
  workflowName: string;
  /** The published version this was compiled from. */
  version: number;
  channel: WorkflowChannel;
  /**
   * Tool names this workflow has an opinion about. A tool outside this set is
   * left exactly as the layers before it decided.
   */
  governedTools: ReadonlySet<string>;
  /** Of the governed ones, those it permits. */
  allowedTools: ReadonlySet<string>;
  /** Recorded for the owner's benefit; connection is enforced elsewhere. */
  requiresIntegrations: ReadonlySet<IntegrationId>;
  /** Parts of the drawing that do not reach the runtime. */
  warnings: string[];
};

export type CompileResult =
  | { ok: true; policy: WorkflowRuntimePolicy }
  | { ok: false; reason: string; warnings: string[] };

/** The newest published version, or null when nothing has been published. */
export function latestPublished(
  record: WorkflowRecord,
): WorkflowDefinition | null {
  if (record.publishedVersions.length === 0) return null;
  return record.publishedVersions.reduce((newest, candidate) =>
    candidate.version > newest.version ? candidate : newest,
  );
}

export function compileWorkflowPolicy(record: WorkflowRecord): CompileResult {
  const warnings: string[] = [];

  // Draft and archived workflows are not running anything, whatever they say.
  if (record.lifecycle !== "published")
    return { ok: false, reason: `This workflow is ${record.lifecycle}.`, warnings };
  if (record.compatibility !== "current")
    return {
      ok: false,
      reason: "This workflow was saved by a newer HelloCrew version.",
      warnings,
    };

  const published = latestPublished(record);
  if (!published)
    return { ok: false, reason: "This workflow has no published version.", warnings };

  // Fail closed: a workflow that does not validate never governs a
  // conversation, even if it was published by an older build.
  const issues = validateWorkflow(published);
  if (issues.length > 0)
    return {
      ok: false,
      reason: issues[0]?.message ?? "This workflow is not valid.",
      warnings,
    };

  const triggers = published.nodes.filter((node) =>
    node.kind.startsWith("trigger."),
  );
  const channel = triggers.length === 1 ? TRIGGER_CHANNEL[triggers[0].kind] : undefined;
  if (!channel)
    return {
      ok: false,
      reason:
        triggers.length === 1
          ? `“${triggers[0].label}” does not start a customer conversation, so this workflow cannot govern one.`
          : "A workflow needs exactly one trigger.",
      warnings,
    };

  const kinds = new Set(published.nodes.map((node) => node.kind));
  const governedTools = new Set<string>();
  const allowedTools = new Set<string>();

  for (const [kind, tools] of Object.entries(GOVERNS) as [
    WorkflowKind,
    readonly string[],
  ][]) {
    for (const tool of tools) {
      governedTools.add(tool);
      // Present means permitted; absent means this workflow does not use it.
      if (kinds.has(kind)) allowedTools.add(tool);
    }
  }

  for (const kind of kinds) {
    if (kind in GOVERNS || STRUCTURAL.includes(kind)) continue;
    warnings.push(
      REVIEWS_ONLY.includes(kind)
        ? `“${kind}” is part of the reviews flow, which runs on its own schedule. It does not change what the receptionist does in a chat.`
        : `“${kind}” has no effect on the live receptionist yet.`,
    );
  }

  const requiresIntegrations = new Set<IntegrationId>();
  if (kinds.has("action.booking")) requiresIntegrations.add("google_calendar");

  return {
    ok: true,
    policy: {
      workflowId: published.id,
      workflowName: published.name,
      version: published.version,
      channel,
      governedTools,
      allowedTools,
      requiresIntegrations,
      warnings,
    },
  };
}

/**
 * The policy for one conversation, or null to leave the agent alone.
 *
 * Null is the ordinary case and it means "behave exactly as before": no
 * workflows saved, none published, none whose trigger matches this channel.
 */
export function selectWorkflowPolicy(
  records: readonly WorkflowRecord[],
  channel: string,
): { policy: WorkflowRuntimePolicy | null; warnings: string[] } {
  const warnings: string[] = [];
  const matches = records
    .map((record) => ({ record, compiled: compileWorkflowPolicy(record) }))
    .filter(
      (entry): entry is { record: WorkflowRecord; compiled: { ok: true; policy: WorkflowRuntimePolicy } } =>
        entry.compiled.ok && entry.compiled.policy.channel === channel,
    );

  if (matches.length === 0) return { policy: null, warnings };

  // Deterministic, never array order: newest change wins, and the id settles
  // a tie so the same data always picks the same workflow.
  const sorted = [...matches].sort((a, b) => {
    const byUpdated = b.record.updatedAt.localeCompare(a.record.updatedAt);
    return byUpdated !== 0
      ? byUpdated
      : a.compiled.policy.workflowId.localeCompare(b.compiled.policy.workflowId);
  });

  if (sorted.length > 1)
    warnings.push(
      `${sorted.length} published workflows start on ${channel}. Using “${sorted[0].compiled.policy.workflowName}”.`,
    );

  return {
    policy: sorted[0].compiled.policy,
    warnings: [...warnings, ...sorted[0].compiled.policy.warnings],
  };
}
