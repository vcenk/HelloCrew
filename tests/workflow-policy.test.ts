import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AIMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";

import { buildAgentContext } from "../lib/agent/context";
import { runAgentTurn } from "../lib/agent/graph";
import { availableContracts } from "../lib/agent/tool-contract";
import { buildTools, contractsForTurn } from "../lib/agent/tools";
import type { TurnEffects } from "../lib/agent/tools";
import { sampleAssistantIdentity } from "../lib/assistant";
import { sampleBusiness } from "../lib/business";
import { createKnowledgeStoreFromBusiness } from "../lib/knowledge";
import {
  createWorkflowRecord,
  publishWorkflowVersion,
  setWorkflowArchived,
  type WorkflowRecord,
} from "../lib/workflow-lifecycle";
import { salonReceptionWorkflow, type WorkflowDefinition } from "../lib/workflow";
import {
  compileWorkflowPolicy,
  selectWorkflowPolicy,
} from "../lib/workflow-policy";

/**
 * Until now a published workflow was a drawing. These prove it reaches the
 * live agent — and, just as importantly, that it can only ever take tools
 * away from what the server already decided to offer.
 */

const context = buildAgentContext(
  sampleAssistantIdentity,
  createKnowledgeStoreFromBusiness(sampleBusiness),
  new Date("2026-10-28T12:00:00Z"),
);
const noEffects = (): TurnEffects => ({ approvals: [], handoffs: [], leads: [] });

/** The salon template, drafted and published, as the builder would leave it. */
function published(
  edit: (workflow: WorkflowDefinition) => WorkflowDefinition = (w) => w,
): WorkflowRecord {
  const record = createWorkflowRecord(edit(structuredClone(salonReceptionWorkflow)));
  return publishWorkflowVersion(record);
}

/**
 * The same workflow with one step taken out, bridged around.
 *
 * Simply deleting a node orphans everything after it and the workflow stops
 * validating — which is correct, and not what we are testing here.
 */
const without = (kind: string) => (workflow: WorkflowDefinition) => {
  const gone = new Set(
    workflow.nodes.filter((node) => node.kind === kind).map((node) => node.id),
  );
  const kept = workflow.edges.filter(
    (edge) => !gone.has(edge.source) && !gone.has(edge.target),
  );
  const bridges = [...gone].flatMap((id) => {
    const sources = workflow.edges.filter((edge) => edge.target === id);
    const targets = workflow.edges.filter((edge) => edge.source === id);
    return sources.flatMap((from) =>
      targets.map((to) => ({
        id: `bridge-${from.source}-${to.target}`,
        source: from.source,
        target: to.target,
      })),
    );
  });
  return {
    ...workflow,
    nodes: workflow.nodes.filter((node) => !gone.has(node.id)),
    edges: [...kept, ...bridges],
  };
};

const toolNames = (narrowing?: {
  governedTools: ReadonlySet<string>;
  allowedTools: ReadonlySet<string>;
}) => [...contractsForTurn(context, noEffects(), undefined, [], narrowing).keys()];

describe("only a published workflow governs anything", () => {
  it("a draft changes nothing", () => {
    const draft = createWorkflowRecord(structuredClone(salonReceptionWorkflow));
    const compiled = compileWorkflowPolicy(draft);
    expect(compiled.ok).toBe(false);
    if (!compiled.ok) expect(compiled.reason).toMatch(/draft/i);
  });

  it("an archived workflow changes nothing", () => {
    const archived = setWorkflowArchived(published(), true);
    const compiled = compileWorkflowPolicy(archived);
    expect(compiled.ok).toBe(false);
  });

  it("a workflow saved by a newer build fails closed", () => {
    const future: WorkflowRecord = {
      ...published(),
      compatibility: "incompatible",
    };
    expect(compileWorkflowPolicy(future).ok).toBe(false);
  });

  it("a published workflow that no longer validates fails closed", () => {
    // Published by an older build, then its trigger went missing.
    const record = published();
    const broken: WorkflowRecord = {
      ...record,
      publishedVersions: record.publishedVersions.map((version) => ({
        ...version,
        nodes: version.nodes.filter((node) => !node.kind.startsWith("trigger.")),
      })),
    };
    expect(compileWorkflowPolicy(broken).ok).toBe(false);
  });

  it("a cyclic workflow fails closed", () => {
    // A loop cannot be a plan. Published or not, it governs nothing.
    const record = published();
    const looped: WorkflowRecord = {
      ...record,
      publishedVersions: record.publishedVersions.map((version) => ({
        ...version,
        edges: [
          ...version.edges,
          {
            id: "loop",
            source: version.nodes[version.nodes.length - 1].id,
            target: version.nodes[0].id,
          },
        ],
      })),
    };
    expect(compileWorkflowPolicy(looped).ok).toBe(false);
  });

  it("a reviews workflow cannot govern a conversation", () => {
    // Its trigger does not start a customer chat, so it has no business
    // deciding what the receptionist may do in one.
    const reviews = published((workflow) => ({
      ...workflow,
      nodes: workflow.nodes.map((node) =>
        node.kind === "trigger.website"
          ? { ...node, kind: "trigger.google_review" as const }
          : node,
      ),
    }));
    const compiled = compileWorkflowPolicy(reviews);
    expect(compiled.ok).toBe(false);
    if (!compiled.ok) expect(compiled.reason).toMatch(/conversation/i);
  });
});

describe("what a published workflow actually changes", () => {
  it("matches the channel its trigger starts on", () => {
    const compiled = compileWorkflowPolicy(published());
    expect(compiled.ok).toBe(true);
    if (compiled.ok) expect(compiled.policy.channel).toBe("website");
  });

  it("keeps the tools its drawing contains", () => {
    const compiled = compileWorkflowPolicy(published());
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    // The salon template has knowledge search, booking and handoff.
    expect(compiled.policy.allowedTools.has("search_knowledge")).toBe(true);
    expect(compiled.policy.allowedTools.has("handoff_to_human")).toBe(true);
    expect(compiled.policy.allowedTools.has("request_booking")).toBe(true);
  });

  it("takes away a tool whose step was removed", () => {
    const compiled = compileWorkflowPolicy(published(without("handoff.inbox")));
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    expect(compiled.policy.governedTools.has("handoff_to_human")).toBe(true);
    expect(compiled.policy.allowedTools.has("handoff_to_human")).toBe(false);

    // And that reaches the real tool list the agent is built from.
    expect(toolNames()).toContain("handoff_to_human");
    expect(toolNames(compiled.policy)).not.toContain("handoff_to_human");
  });

  it("leaves tools it says nothing about alone", () => {
    // No node kind maps to leads. A workflow that never mentions them must
    // not switch them off as a side effect of being drawn.
    const compiled = compileWorkflowPolicy(published(without("handoff.inbox")));
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.policy.governedTools.has("capture_lead")).toBe(false);
    expect(toolNames(compiled.policy)).toContain("capture_lead");
  });

  it("switching published versions changes the policy predictably", () => {
    const first = published();
    const second = publishWorkflowVersion(
      first,
      without("handoff.inbox")(first.workflow),
    );

    const before = compileWorkflowPolicy(first);
    const after = compileWorkflowPolicy(second);
    expect(before.ok && after.ok).toBe(true);
    if (!before.ok || !after.ok) return;

    expect(after.policy.version).toBe(before.policy.version + 1);
    expect(before.policy.allowedTools.has("handoff_to_human")).toBe(true);
    expect(after.policy.allowedTools.has("handoff_to_human")).toBe(false);
  });

  it("says plainly which steps do nothing to the live receptionist", () => {
    const compiled = compileWorkflowPolicy(published());
    expect(compiled.ok).toBe(true);
    // The salon template contains logic.confidence, which has no runtime
    // equivalent. Silence there would be a lie.
    if (compiled.ok)
      expect(compiled.policy.warnings.join(" ")).toMatch(/logic.confidence/);
  });
});

describe("a workflow can narrow but never grant", () => {
  it("cannot name a tool the registry does not have", () => {
    const invented = {
      governedTools: new Set(["delete_everything"]),
      allowedTools: new Set(["delete_everything"]),
    };
    expect(toolNames(invented)).not.toContain("delete_everything");
  });

  it("cannot bring back a tool the crew switched off", () => {
    // Layer 4 beats layer 5: booking off means off, however it was drawn.
    const bookingOff = {
      ...context,
      skills: { ...context.skills, booking: "off" as const },
    };
    const allowAll = {
      governedTools: new Set(["request_booking"]),
      allowedTools: new Set(["request_booking"]),
    };
    const names = [
      ...contractsForTurn(bookingOff, noEffects(), undefined, [], allowAll).keys(),
    ];
    expect(names).not.toContain("request_booking");
  });

  it("cannot reach a tool whose integration is not connected", () => {
    // Layer 3 beats layer 5. The calendar tools need a connection, and a
    // workflow permitting them does not make one exist.
    const calendarTool = {
      name: "propose_booking",
      description: "",
      schema: z.object({}),
      effect: "needs_approval" as const,
      scope: "conversation" as const,
      approval: "owner" as const,
      requires: "google_calendar" as const,
      audit: { action: "x", recordsPii: false },
      isEnabled: () => true,
      run: () => "",
    };
    const offered = availableContracts(
      [calendarTool],
      context,
      new Set(),
      {
        governedTools: new Set(["propose_booking"]),
        allowedTools: new Set(["propose_booking"]),
      },
    );
    expect(offered).toHaveLength(0);
  });

  it("cannot make booking skip the owner", () => {
    // There is no approval-free booking mode to ask for: booking allows only
    // off or ask, so every booking tool a workflow can permit is one that
    // already waits for the owner.
    const compiled = compileWorkflowPolicy(published());
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const contracts = contractsForTurn(
      context,
      noEffects(),
      undefined,
      [],
      compiled.policy,
    );
    const booking = contracts.get("request_booking");
    expect(booking).toBeTruthy();
    expect(booking!.effect).toBe("needs_approval");
    expect(booking!.approval).toBe("owner");
  });
});

describe("choosing which workflow governs a conversation", () => {
  it("none at all leaves the agent exactly as it was", () => {
    expect(selectWorkflowPolicy([], "website").policy).toBeNull();
    expect(toolNames(undefined)).toEqual(toolNames());
  });

  it("ignores a channel no workflow starts on", () => {
    expect(selectWorkflowPolicy([published()], "whatsapp").policy).toBeNull();
  });

  it("is deterministic when two workflows match", () => {
    const older: WorkflowRecord = {
      ...published(),
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const newer: WorkflowRecord = {
      ...published(without("handoff.inbox")),
      updatedAt: "2026-06-01T00:00:00.000Z",
    };

    const forwards = selectWorkflowPolicy([older, newer], "website");
    const backwards = selectWorkflowPolicy([newer, older], "website");
    // Array order must not decide which workflow runs a business.
    expect(forwards.policy?.allowedTools.has("handoff_to_human")).toBe(
      backwards.policy?.allowedTools.has("handoff_to_human"),
    );
    expect(forwards.policy?.allowedTools.has("handoff_to_human")).toBe(false);
    expect(forwards.warnings.join(" ")).toMatch(/2 published workflows/);
  });

  it("skips drafts and archives when picking", () => {
    const draft = createWorkflowRecord(structuredClone(salonReceptionWorkflow));
    const archived = setWorkflowArchived(published(), true);
    expect(selectWorkflowPolicy([draft, archived], "website").policy).toBeNull();
  });
});

/** A model that calls whatever it is told, so we can see what it was offered. */
function scriptedModel(script: AIMessage[]) {
  const seen: BaseMessage[][] = [];
  let bound: { name: string }[] = [];
  const runnable = {
    invoke: async (messages: BaseMessage[]) => {
      seen.push(messages);
      return script.shift() ?? new AIMessage({ content: "done" });
    },
  };
  return {
    model: {
      ...runnable,
      bindTools: (tools: { name: string }[]) => {
        bound = tools;
        return runnable;
      },
    } as unknown as BaseChatModel,
    offered: () => bound.map((tool) => tool.name),
  };
}

describe("a real agent turn under a published workflow", () => {
  it("is offered only what the workflow allows", async () => {
    const compiled = compileWorkflowPolicy(published(without("handoff.inbox")));
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const { model, offered } = scriptedModel([new AIMessage({ content: "Hi." })]);
    await runAgentTurn(model, context, [{ role: "user", content: "hello" }], {
      narrowing: compiled.policy,
    });

    // The actual construction path, not the compiler in isolation.
    expect(offered()).toContain("search_knowledge");
    expect(offered()).not.toContain("handoff_to_human");
  });

  it("is offered everything when no workflow governs it", async () => {
    const { model, offered } = scriptedModel([new AIMessage({ content: "Hi." })]);
    await runAgentTurn(model, context, [{ role: "user", content: "hello" }], {});
    expect(offered()).toContain("handoff_to_human");
  });

  it("cannot call a tool the workflow removed", async () => {
    // Even a model that insists: the name is not bound and not in the effect
    // map, so the graph refuses it as an unknown tool.
    const compiled = compileWorkflowPolicy(published(without("handoff.inbox")));
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const { model } = scriptedModel([
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "a", name: "handoff_to_human", args: { reason: "upset" } },
        ],
      }),
      new AIMessage({ content: "Sorry." }),
    ]);
    const result = await runAgentTurn(
      model,
      context,
      [{ role: "user", content: "get me a person" }],
      { narrowing: compiled.policy },
    );

    expect(result.handoffs).toEqual([]);
    expect(
      result.activity.some((entry) => entry.label === "Blocked an unknown tool"),
    ).toBe(true);
  });
});

describe("the tools the agent builds", () => {
  it("bind the same set the effect map describes", () => {
    // If these two disagreed, a tool could run with the wrong safety.
    const compiled = compileWorkflowPolicy(published(without("knowledge.search")));
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const effects = noEffects();
    const bound = buildTools(context, effects, undefined, [], compiled.policy).map(
      (tool) => tool.name,
    );
    const contracts = [
      ...contractsForTurn(context, effects, undefined, [], compiled.policy).keys(),
    ];
    expect(bound.sort()).toEqual(contracts.sort());
    expect(bound).not.toContain("search_knowledge");
  });
});
