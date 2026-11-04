import type { IntegrationId } from "@/lib/agent/tool-contract";
import { knowledgeKinds, type KnowledgeKind } from "@/lib/knowledge";
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
 *
 * The same holds for the per-step settings. A compiled setting can give the
 * agent a different voice or a smaller slice of the knowledge base; none can
 * switch anything on. A setting the runtime cannot honour becomes a warning
 * instead of a silent no-op, so an owner is never left believing a control is
 * protecting them when it is doing nothing.
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
  // Listed here only to keep the generic "has no effect" line off it. It gets
  // a specific warning below that says what does decide handoff instead,
  // which is more use than being told twice that it does nothing.
  "logic.confidence",
];

/**
 * Booking tools that write, or ask the owner to. "Prepare request only" keeps
 * the read-only availability lookup and the plain request — it withholds the
 * ones that reach the calendar.
 */
const BOOKING_WRITES = [
  "propose_booking",
  "cancel_booking",
  "reschedule_booking",
] as const;

/**
 * What each "Knowledge to search" choice lets the agent see.
 *
 * The options are prose because the builder shows them to owners. Mapping
 * them here rather than in the runtime keeps the one translation in the one
 * place that already knows what a workflow means.
 */
const KNOWLEDGE_CHOICES: Record<string, readonly KnowledgeKind[]> = {
  "Services, FAQs and documents": ["service", "faq", "document", "hours"],
  "Services, policies and preparation notes": [
    "service",
    "policy",
    "document",
    "hours",
  ],
  "Services and FAQs": ["service", "faq", "hours"],
  "FAQs only": ["faq"],
  "Documents only": ["document"],
};

/** A node's setting, as a trimmed string, or undefined when it is not set. */
function setting(
  node: { config?: Record<string, unknown> },
  key: string,
): string | undefined {
  const raw = node.config?.[key];
  if (raw === undefined || raw === null) return undefined;
  const text = String(raw).trim();
  return text === "" ? undefined : text;
}

/** Belongs to the reviews path, which is a scheduled sync, not live chat. */
const REVIEWS_ONLY: readonly WorkflowKind[] = [
  "trigger.google_review",
  "action.google_review_reply",
  "logic.review_risk",
  "handoff.review_follow_up",
  "output.review_complete",
];

/**
 * Per-step settings that reach a live conversation.
 *
 * Every field here can only make the agent do less than it otherwise would:
 * a narrower voice, a smaller slice of the knowledge base. None of them can
 * switch a skill on, reach an integration, or remove an approval — the same
 * property the tool narrowing has, and for the same reason. A setting the
 * runtime cannot honour is not represented here at all; it becomes a warning,
 * because silently accepting it is how an owner comes to believe a safety
 * control is on when it is not.
 */
export type WorkflowConversationPolicy = {
  /** Replaces the assistant's configured voice while this workflow governs. */
  tone?: string;
  /** The only knowledge kinds the agent may use. Absent means all of them. */
  knowledgeKinds?: ReadonlySet<KnowledgeKind>;
};

export type WorkflowRuntimePolicy = {
  workflowId: string;
  workflowName: string;
  /** The published version this was compiled from. */
  version: number;
  channel: WorkflowChannel;
  /** Per-step settings the runtime honours. */
  conversation: WorkflowConversationPolicy;
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

  const conversation = compileConversationPolicy(published, warnings);

  // "Prepare request only" keeps the request and the availability lookup and
  // withholds everything that reaches the calendar. Taken off allowedTools
  // rather than added anywhere: a mode cannot grant a tool, only drop one.
  const booking = published.nodes.find((node) => node.kind === "action.booking");
  if (booking && setting(booking, "mode") === "prepare_only")
    for (const tool of BOOKING_WRITES) allowedTools.delete(tool);

  const requiresIntegrations = new Set<IntegrationId>();
  if (kinds.has("action.booking")) requiresIntegrations.add("google_calendar");

  return {
    ok: true,
    policy: {
      workflowId: published.id,
      workflowName: published.name,
      version: published.version,
      channel,
      conversation,
      governedTools,
      allowedTools,
      requiresIntegrations,
      warnings,
    },
  };
}

/**
 * Reads the per-step settings, and says plainly which ones go nowhere.
 *
 * The owner configures all of these on the canvas. Before this, every one of
 * them was decoration. Three now govern; the rest are named as not governing
 * rather than left to look as though they do.
 */
function compileConversationPolicy(
  published: WorkflowDefinition,
  warnings: string[],
): WorkflowConversationPolicy {
  const policy: WorkflowConversationPolicy = {};
  const nodeOf = (kind: WorkflowKind) =>
    published.nodes.find((node) => node.kind === kind);

  const respond = nodeOf("ai.respond");
  if (respond) {
    const tone = setting(respond, "tone");
    if (tone) policy.tone = tone;
    // The prompt already tells the agent to answer in the customer's own
    // language, which is a superset of any list drawn here.
    if (setting(respond, "languages"))
      warnings.push(
        "The receptionist already replies in whatever language the customer writes in, so “Supported languages” does not change anything.",
      );
    if (setting(respond, "model"))
      warnings.push(
        "“Model policy” is not read yet. The model is chosen per turn by cost and availability, in Settings.",
      );
  }

  const search = nodeOf("knowledge.search");
  const sources = search ? setting(search, "sources") : undefined;
  if (sources) {
    const allowed = KNOWLEDGE_CHOICES[sources];
    if (allowed) policy.knowledgeKinds = new Set(allowed);
    else
      warnings.push(
        `“${sources}” is not a knowledge selection this version understands, so every kind stays searchable.`,
      );
  }
  if (search && setting(search, "resultLimit"))
    warnings.push(
      "“Maximum sources” is not read yet. How much knowledge reaches the model is capped by the prompt budget instead.",
    );

  // The settings that look like safety controls and are not. These matter
  // most: an owner who believes a threshold is protecting them is worse off
  // than one who knows it is not.
  // Warned about whether or not a threshold is filled in: the step itself
  // routes nothing, so an empty one is no more honest than a set one.
  const confidence = nodeOf("logic.confidence");
  if (confidence)
    warnings.push(
      "“Minimum confidence” does not route anything yet — the live receptionist has no confidence score. Whether a chat goes to a person is decided by the Hand off skill on the Crew page.",
    );

  const approval = nodeOf("approval.owner");
  if (approval) {
    if (setting(approval, "timeoutMinutes"))
      warnings.push(
        "“Approval expires after” is not enforced yet. An approval stays valid until it is answered.",
      );
    if (setting(approval, "approvalFor"))
      warnings.push(
        "“What needs approval” is not shown on the approval card yet. Which actions wait for you is set by the actions themselves, and this workflow cannot widen or narrow it.",
      );
  }

  const trigger = nodeOf("trigger.website");
  if (trigger) {
    if (setting(trigger, "greeting"))
      warnings.push(
        "The welcome message visitors see comes from Crew → Receptionist → Channels, not from this step.",
      );
    if (setting(trigger, "availability") === "business_hours")
      warnings.push(
        "“Business hours” is not applied yet. The website chat answers whenever it is switched on.",
      );
  }

  const handoff = nodeOf("handoff.inbox");
  const destination = handoff ? setting(handoff, "destination") : undefined;
  if (destination && destination !== "Dashboard inbox")
    warnings.push(
      `“${destination}” is not available yet. Handoffs go to the dashboard inbox.`,
    );

  return policy;
}

/**
 * What these steps would do to a live conversation if they were published.
 *
 * The builder shows this while the owner is still editing. It runs the very
 * code the runtime runs, so the panel cannot drift into promising something
 * the agent does not do.
 */
export function previewWorkflowSettings(definition: WorkflowDefinition): {
  conversation: WorkflowConversationPolicy;
  warnings: string[];
} {
  const warnings: string[] = [];
  return { conversation: compileConversationPolicy(definition, warnings), warnings };
}

/** Knowledge kinds a policy permits, for callers that have no set. */
export function permittedKnowledgeKinds(
  policy: WorkflowConversationPolicy | null | undefined,
): ReadonlySet<KnowledgeKind> {
  return policy?.knowledgeKinds ?? new Set(knowledgeKinds);
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

  // Deterministic, and never array order: the most recently *published* one
  // wins, with the id settling a tie. Deliberately not updatedAt — that moves
  // whenever a draft is saved, so selection would follow whoever last opened
  // a workflow in the builder rather than whoever last published one. Records
  // written before publishing was timestamped fall back to updatedAt.
  const publishedAt = (entry: (typeof matches)[number]) =>
    entry.record.lastPublishedAt ?? entry.record.updatedAt;
  const sorted = [...matches].sort((a, b) => {
    const byPublished = publishedAt(b).localeCompare(publishedAt(a));
    return byPublished !== 0
      ? byPublished
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
