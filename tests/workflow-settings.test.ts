import { describe, expect, it } from "vitest";

import { buildAgentContext } from "../lib/agent/context";
import { buildSystemPrompt, permittedSources } from "../lib/agent/prompt";
import { contractsForTurn, type TurnEffects } from "../lib/agent/tools";
import { sampleAssistantIdentity } from "../lib/assistant";
import { sampleBusiness } from "../lib/business";
import { createKnowledgeStoreFromBusiness, type KnowledgeKind } from "../lib/knowledge";
import {
  createWorkflowRecord,
  publishWorkflowVersion,
  type WorkflowRecord,
} from "../lib/workflow-lifecycle";
import { salonReceptionWorkflow, type WorkflowDefinition } from "../lib/workflow";
import {
  compileWorkflowPolicy,
  previewWorkflowSettings,
} from "../lib/workflow-policy";

/**
 * The per-step settings an owner fills in on the canvas.
 *
 * Until now every one of them was decoration: the workflow narrowed which
 * tools the agent had and nothing else. These cover the three that now reach
 * a live conversation, the rule that none of them can make the agent do more,
 * and — the part that matters most — that a setting the runtime cannot honour
 * says so instead of looking like it works.
 */

const knowledge = createKnowledgeStoreFromBusiness(sampleBusiness);
const baseContext = buildAgentContext(
  sampleAssistantIdentity,
  knowledge,
  new Date("2026-11-04T12:00:00Z"),
);
const noEffects = (): TurnEffects => ({ approvals: [], handoffs: [], leads: [] });

/** The salon template with one node's settings changed, then published. */
function publishedWith(
  kind: string,
  config: Record<string, string | number | boolean>,
): WorkflowRecord {
  const workflow: WorkflowDefinition = {
    ...structuredClone(salonReceptionWorkflow),
    nodes: structuredClone(salonReceptionWorkflow).nodes.map((node) =>
      node.kind === kind ? { ...node, config: { ...node.config, ...config } } : node,
    ),
  };
  return publishWorkflowVersion(createWorkflowRecord(workflow));
}

function policyOf(record: WorkflowRecord) {
  const compiled = compileWorkflowPolicy(record);
  if (!compiled.ok) throw new Error(`expected a policy: ${compiled.reason}`);
  return compiled.policy;
}

describe("the voice a workflow sets", () => {
  it("replaces the assistant's own voice in the prompt", () => {
    const { conversation } = policyOf(
      publishedWith("ai.respond", { tone: "Calm and professional" }),
    );
    expect(conversation.tone).toBe("Calm and professional");

    const prompt = buildSystemPrompt({ ...baseContext, ...conversation });
    expect(prompt).toContain("Voice: Calm and professional");
    expect(prompt).not.toContain(`Voice: ${sampleAssistantIdentity.tone}`);
  });

  it("leaves the assistant's voice alone when no workflow governs", () => {
    const prompt = buildSystemPrompt(baseContext);
    expect(prompt).toContain(`Voice: ${sampleAssistantIdentity.tone}`);
  });

  it("changes no rule, only the voice line", () => {
    // Style is the one thing a workflow may set outright, precisely because
    // it cannot weaken anything. This pins that it stays that way.
    const governed = buildSystemPrompt({
      ...baseContext,
      tone: "Calm and professional",
    });
    const plain = buildSystemPrompt(baseContext);
    const rulesOf = (prompt: string) =>
      prompt.split("\n").filter((line) => /^\d\./.test(line));
    expect(rulesOf(governed)).toEqual(rulesOf(plain));
  });
});

describe("the knowledge a workflow lets the agent use", () => {
  const faqOnly = () =>
    policyOf(publishedWith("knowledge.search", { sources: "FAQs only" }))
      .conversation;

  it("keeps only the kinds it names", () => {
    const kinds = faqOnly().knowledgeKinds;
    expect(kinds && [...kinds]).toEqual(["faq"]);
  });

  it("drops the other kinds from the prompt", () => {
    const restricted = { ...baseContext, ...faqOnly() };
    const sources = permittedSources(restricted);
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((source) => source.kind === "faq")).toBe(true);
    expect(sources.length).toBeLessThan(baseContext.approvedSources.length);
  });

  it("cannot reach knowledge the owner has not approved", () => {
    // The restriction filters what was already approved. Naming a kind can
    // never be a way to surface a draft or an outdated item.
    const everything = new Set<KnowledgeKind>([
      "hours",
      "service",
      "faq",
      "policy",
      "document",
    ]);
    const widened = permittedSources({
      ...baseContext,
      knowledgeKinds: everything,
    });
    expect(widened).toEqual(baseContext.approvedSources);
    expect(widened.every((source) => source.status === "approved")).toBe(true);
  });

  it("hides hours and services from get_business_details too", async () => {
    // Otherwise the model simply asks for them here instead, and the
    // restriction is theatre.
    const tools = contractsForTurn(
      { ...baseContext, ...faqOnly() },
      noEffects(),
    );
    const details = tools.get("get_business_details");
    const answer = JSON.parse(
      String(await details!.run({}, { ...baseContext, ...faqOnly() })),
    );
    expect(answer.hours).toBeUndefined();
    expect(answer.services).toBeUndefined();
    expect(answer.name).toBe(baseContext.business.name);
  });

  it("leaves everything searchable when no workflow governs", () => {
    expect(permittedSources(baseContext)).toEqual(baseContext.approvedSources);
  });
});

describe("preparing a booking request instead of making one", () => {
  it("withholds the tools that reach the calendar", () => {
    const policy = policyOf(publishedWith("action.booking", { mode: "prepare_only" }));
    for (const tool of ["propose_booking", "cancel_booking", "reschedule_booking"])
      expect(policy.allowedTools.has(tool), tool).toBe(false);
  });

  it("keeps the plain request and the read-only availability lookup", () => {
    const policy = policyOf(publishedWith("action.booking", { mode: "prepare_only" }));
    expect(policy.allowedTools.has("request_booking")).toBe(true);
    expect(policy.allowedTools.has("check_availability")).toBe(true);
  });

  it("allows them again under the ordinary approval mode", () => {
    const policy = policyOf(
      publishedWith("action.booking", { mode: "approval_required" }),
    );
    expect(policy.allowedTools.has("propose_booking")).toBe(true);
  });

  it("never grants a tool the workflow has no node for", () => {
    // The mode only ever deletes. A workflow without a booking step has no
    // booking tools whatever its settings say.
    const policy = policyOf(publishedWith("ai.respond", { tone: "Friendly and concise" }));
    const booking = [...policy.governedTools].filter((tool) =>
      tool.includes("booking"),
    );
    for (const tool of booking)
      expect(policy.allowedTools.has(tool)).toBe(
        salonReceptionWorkflow.nodes.some((node) => node.kind === "action.booking"),
      );
  });
});

describe("settings that look like they govern and do not", () => {
  const warningsFor = (kind: string, config: Record<string, string | number>) =>
    policyOf(publishedWith(kind, config)).warnings.join(" ");

  it("says the confidence threshold routes nothing", () => {
    // The worst of them: an owner can believe this is deciding when a person
    // gets involved, and it is not.
    const warnings = warningsFor("logic.confidence", { threshold: 0.9 });
    expect(warnings).toMatch(/minimum confidence/i);
    expect(warnings).toMatch(/no confidence score/i);
    // And points at what actually decides it.
    expect(warnings).toMatch(/hand off skill/i);
  });

  it("says approvals do not expire", () => {
    expect(warningsFor("approval.owner", { timeoutMinutes: 30 })).toMatch(
      /does not expire|not enforced/i,
    );
  });

  it("says the welcome message comes from somewhere else", () => {
    expect(warningsFor("trigger.website", { greeting: "Hello there" })).toMatch(
      /channels/i,
    );
  });

  it("says business hours are not applied", () => {
    expect(
      warningsFor("trigger.website", { availability: "business_hours" }),
    ).toMatch(/business hours/i);
  });

  it("stays quiet about a destination that does exist", () => {
    const warnings = warningsFor("handoff.inbox", {
      destination: "Dashboard inbox",
    });
    expect(warnings).not.toMatch(/not available yet/i);
  });

  it("warns about one that does not", () => {
    expect(warningsFor("handoff.inbox", { destination: "Callback queue" })).toMatch(
      /not available yet/i,
    );
  });

  it("does not treat a working setting as a warning", () => {
    const policy = policyOf(publishedWith("ai.respond", { tone: "Calm and professional" }));
    expect(policy.warnings.join(" ")).not.toMatch(/response style|voice/i);
  });
});

describe("what the builder shows before publishing", () => {
  it("is the compiler's own answer, not a second opinion", () => {
    const record = publishedWith("logic.confidence", { threshold: 0.9 });
    const live = policyOf(record);
    const preview = previewWorkflowSettings(
      record.publishedVersions[record.publishedVersions.length - 1],
    );

    expect(preview.conversation).toEqual(live.conversation);
    // The live warnings also carry the whole-workflow ones, so the preview is
    // a subset rather than equal — every preview warning is a real one.
    for (const warning of preview.warnings)
      expect(live.warnings).toContain(warning);
  });

  it("describes an unpublished draft, which governs nothing yet", () => {
    // The panel exists to answer "what would publishing do", so it has to
    // work on a draft the compiler itself refuses.
    const draft = createWorkflowRecord(structuredClone(salonReceptionWorkflow));
    expect(compileWorkflowPolicy(draft).ok).toBe(false);
    expect(previewWorkflowSettings(draft.workflow).conversation.tone).toBe(
      "Friendly and concise",
    );
  });
});
