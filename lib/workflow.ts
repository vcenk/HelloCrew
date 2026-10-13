import { z } from "zod";

export const workflowKinds = [
  "trigger.website",
  "knowledge.search",
  "ai.respond",
  "logic.confidence",
  "approval.owner",
  "action.booking",
  "handoff.inbox",
  "output.reply",
] as const;

export type WorkflowKind = (typeof workflowKinds)[number];
export type WorkflowStatus = "draft" | "published" | "archived";

export type WorkflowNode = {
  id: string;
  kind: WorkflowKind;
  label: string;
  description: string;
  position: { x: number; y: number };
  config: Record<string, string | number | boolean>;
};

export type WorkflowEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
};

export type WorkflowDefinition = {
  id: string;
  name: string;
  version: number;
  status: WorkflowStatus;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};

export type WorkflowIssue = {
  code:
    | "invalid_shape"
    | "missing_trigger"
    | "multiple_triggers"
    | "missing_destination"
    | "duplicate_id"
    | "missing_endpoint"
    | "self_loop"
    | "cycle"
    | "unreachable_node"
    | "approval_required";
  message: string;
  nodeId?: string;
  edgeId?: string;
};

const nodeSchema = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum(workflowKinds),
  label: z.string().min(1).max(80),
  description: z.string().max(240),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }),
  config: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

const edgeSchema = z.object({
  id: z.string().min(1).max(80),
  source: z.string().min(1).max(80),
  target: z.string().min(1).max(80),
  label: z.string().max(80).optional(),
});

const workflowSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(100),
  version: z.number().int().positive(),
  status: z.enum(["draft", "published", "archived"]),
  nodes: z.array(nodeSchema).max(40),
  edges: z.array(edgeSchema).max(80),
});

export function validateWorkflow(input: WorkflowDefinition): WorkflowIssue[] {
  const parsed = workflowSchema.safeParse(input);
  if (!parsed.success) {
    return [
      {
        code: "invalid_shape",
        message: parsed.error.issues[0]?.message ?? "The workflow is invalid.",
      },
    ];
  }

  const workflow = parsed.data;
  const issues: WorkflowIssue[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();

  for (const node of workflow.nodes) {
    if (nodeIds.has(node.id)) {
      issues.push({
        code: "duplicate_id",
        nodeId: node.id,
        message: `Node ID “${node.id}” is used more than once.`,
      });
    }
    nodeIds.add(node.id);
  }

  const triggers = workflow.nodes.filter((node) =>
    node.kind.startsWith("trigger."),
  );
  if (triggers.length === 0)
    issues.push({
      code: "missing_trigger",
      message: "Add one channel trigger to start the workflow.",
    });
  if (triggers.length > 1)
    issues.push({
      code: "multiple_triggers",
      message: "A workflow can have only one starting trigger.",
    });

  if (
    !workflow.nodes.some(
      (node) =>
        node.kind.startsWith("output.") || node.kind.startsWith("handoff."),
    )
  ) {
    issues.push({
      code: "missing_destination",
      message: "Add a reply or human handoff destination.",
    });
  }

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const edge of workflow.edges) {
    if (edgeIds.has(edge.id)) {
      issues.push({
        code: "duplicate_id",
        edgeId: edge.id,
        message: `Connection ID “${edge.id}” is used more than once.`,
      });
    }
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      issues.push({
        code: "missing_endpoint",
        edgeId: edge.id,
        message: "A connection points to a node that no longer exists.",
      });
      continue;
    }
    if (edge.source === edge.target) {
      issues.push({
        code: "self_loop",
        edgeId: edge.id,
        message: "A node cannot connect to itself.",
      });
      continue;
    }
    outgoing.set(edge.source, [
      ...(outgoing.get(edge.source) ?? []),
      edge.target,
    ]);
    incoming.set(edge.target, [
      ...(incoming.get(edge.target) ?? []),
      edge.source,
    ]);
  }

  const startId = triggers[0]?.id;
  const reachable = new Set<string>();
  const active = new Set<string>();
  let hasCycle = false;
  function walk(nodeId: string) {
    if (active.has(nodeId)) {
      hasCycle = true;
      return;
    }
    if (reachable.has(nodeId)) return;
    reachable.add(nodeId);
    active.add(nodeId);
    for (const next of outgoing.get(nodeId) ?? []) walk(next);
    active.delete(nodeId);
  }
  if (startId) walk(startId);
  if (hasCycle)
    issues.push({
      code: "cycle",
      message: "Connections must move forward without forming a loop.",
    });

  for (const node of workflow.nodes) {
    if (startId && !reachable.has(node.id)) {
      issues.push({
        code: "unreachable_node",
        nodeId: node.id,
        message: `“${node.label}” is not connected to the starting trigger.`,
      });
    }
    if (node.kind === "action.booking") {
      const visited = new Set<string>();
      const queue = [...(incoming.get(node.id) ?? [])];
      let protectedByApproval = false;
      while (queue.length > 0) {
        const candidate = queue.shift()!;
        if (visited.has(candidate)) continue;
        visited.add(candidate);
        const upstream = workflow.nodes.find((item) => item.id === candidate);
        if (upstream?.kind === "approval.owner") {
          protectedByApproval = true;
          break;
        }
        queue.push(...(incoming.get(candidate) ?? []));
      }
      if (!protectedByApproval)
        issues.push({
          code: "approval_required",
          nodeId: node.id,
          message: `“${node.label}” needs an owner approval earlier in the flow.`,
        });
    }
  }

  return issues;
}

export const salonReceptionWorkflow: WorkflowDefinition = {
  id: "salon-reception-v1",
  name: "Salon reception assistant",
  version: 1,
  status: "draft",
  nodes: [
    {
      id: "website-message",
      kind: "trigger.website",
      label: "Website message",
      description: "Starts when a visitor sends a message.",
      position: { x: 40, y: 210 },
      config: { channel: "website" },
    },
    {
      id: "business-knowledge",
      kind: "knowledge.search",
      label: "Business knowledge",
      description: "Searches approved services, FAQs and documents.",
      position: { x: 310, y: 80 },
      config: { sources: "FAQs, services, documents", resultLimit: 5 },
    },
    {
      id: "assistant-response",
      kind: "ai.respond",
      label: "Draft a response",
      description: "Creates a grounded answer in the visitor’s language.",
      position: { x: 580, y: 80 },
      config: { model: "Minimum effective model", languages: "EN, FA, ZH" },
    },
    {
      id: "confidence-check",
      kind: "logic.confidence",
      label: "Check confidence",
      description: "Routes uncertain answers to a person.",
      position: { x: 850, y: 80 },
      config: { threshold: 0.75 },
    },
    {
      id: "owner-approval",
      kind: "approval.owner",
      label: "Owner approval",
      description: "Requires review before a booking is created.",
      position: { x: 310, y: 350 },
      config: { timeoutMinutes: 30 },
    },
    {
      id: "booking-action",
      kind: "action.booking",
      label: "Create booking",
      description: "Uses a future Phorest or calendar adapter.",
      position: { x: 580, y: 350 },
      config: { provider: "Not connected", mode: "approval_required" },
    },
    {
      id: "human-inbox",
      kind: "handoff.inbox",
      label: "Human inbox",
      description: "Prepares context for a team member.",
      position: { x: 1120, y: 250 },
      config: { destination: "Dashboard inbox" },
    },
    {
      id: "website-reply",
      kind: "output.reply",
      label: "Reply on website",
      description: "Returns the final approved response.",
      position: { x: 1120, y: 20 },
      config: { channel: "website" },
    },
  ],
  edges: [
    {
      id: "e-trigger-knowledge",
      source: "website-message",
      target: "business-knowledge",
    },
    {
      id: "e-trigger-approval",
      source: "website-message",
      target: "owner-approval",
      label: "booking request",
    },
    {
      id: "e-knowledge-ai",
      source: "business-knowledge",
      target: "assistant-response",
    },
    {
      id: "e-ai-confidence",
      source: "assistant-response",
      target: "confidence-check",
    },
    {
      id: "e-confidence-reply",
      source: "confidence-check",
      target: "website-reply",
      label: "confident",
    },
    {
      id: "e-confidence-human",
      source: "confidence-check",
      target: "human-inbox",
      label: "needs help",
    },
    {
      id: "e-approval-booking",
      source: "owner-approval",
      target: "booking-action",
      label: "approved",
    },
    {
      id: "e-booking-reply",
      source: "booking-action",
      target: "website-reply",
    },
  ],
};
