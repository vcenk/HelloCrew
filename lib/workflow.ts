import { z } from "zod";

export const workflowKinds = [
  "trigger.website",
  "trigger.google_review",
  "knowledge.search",
  "ai.respond",
  "logic.confidence",
  "logic.review_risk",
  "approval.owner",
  "action.booking",
  "action.google_review_reply",
  "handoff.inbox",
  "handoff.review_follow_up",
  "output.reply",
  "output.review_complete",
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

export function parseWorkflowDefinition(input: unknown) {
  return workflowSchema.safeParse(input);
}

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
    if (
      node.kind === "action.booking" ||
      node.kind === "action.google_review_reply"
    ) {
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
      config: {
        channel: "website",
        greeting: "Hi! How can we help today?",
        availability: "always",
      },
    },
    {
      id: "business-knowledge",
      kind: "knowledge.search",
      label: "Business knowledge",
      description: "Searches approved services, FAQs and documents.",
      position: { x: 310, y: 80 },
      config: { sources: "Services, FAQs and documents", resultLimit: 5 },
    },
    {
      id: "assistant-response",
      kind: "ai.respond",
      label: "Draft a response",
      description: "Creates a grounded answer in the visitor’s language.",
      position: { x: 580, y: 80 },
      config: {
        model: "Managed for cost and quality",
        languages: "EN, FA, ZH",
        tone: "Friendly and concise",
      },
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
      config: { timeoutMinutes: 30, approvalFor: "Booking requests" },
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
      config: {
        channel: "website",
        closingMessage: "Is there anything else we can help with?",
        showSources: false,
      },
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

export type WorkflowTemplate = {
  id: string;
  name: string;
  category: "Salon" | "Clinic" | "Service business" | "Reputation";
  description: string;
  setupMinutes: number;
  editableSummary: string;
  workflow: WorkflowDefinition;
};

const clinicFrontDeskWorkflow: WorkflowDefinition = {
  ...salonReceptionWorkflow,
  id: "clinic-front-desk-v1",
  name: "Clinic front desk",
  nodes: salonReceptionWorkflow.nodes.map((node) => {
    if (node.id === "business-knowledge")
      return {
        ...node,
        label: "Clinic information",
        description:
          "Searches approved services, policies and preparation notes.",
        config: {
          sources: "Services, policies and preparation notes",
          resultLimit: 5,
        },
      };
    if (node.id === "assistant-response")
      return {
        ...node,
        label: "Draft a careful answer",
        description: "Answers administrative questions without medical advice.",
        config: {
          model: "Managed for cost and quality",
          languages: "EN, FA, ZH",
          tone: "Calm and professional",
        },
      };
    if (node.id === "owner-approval")
      return {
        ...node,
        label: "Staff approval",
        description: "Requires staff review before requesting an appointment.",
        config: { timeoutMinutes: 15, approvalFor: "Appointment requests" },
      };
    if (node.id === "booking-action")
      return {
        ...node,
        label: "Request appointment",
        description: "Uses a future clinic calendar adapter.",
        config: { provider: "Not connected", mode: "approval_required" },
      };
    return node;
  }),
};

const serviceConciergeWorkflow: WorkflowDefinition = {
  id: "service-concierge-v1",
  name: "Service business concierge",
  version: 1,
  status: "draft",
  nodes: salonReceptionWorkflow.nodes
    .filter(
      (node) =>
        node.kind !== "approval.owner" && node.kind !== "action.booking",
    )
    .map((node) => {
      if (node.id === "business-knowledge")
        return {
          ...node,
          label: "Services and FAQs",
          description:
            "Searches approved services, FAQs and uploaded documents.",
          config: { sources: "Services, FAQs and documents", resultLimit: 5 },
        };
      if (node.id === "assistant-response")
        return {
          ...node,
          label: "Draft a helpful answer",
          config: {
            model: "Managed for cost and quality",
            languages: "EN, FA, ZH",
            tone: "Friendly and concise",
          },
        };
      return node;
    }),
  edges: salonReceptionWorkflow.edges.filter(
    (edge) =>
      !["e-trigger-approval", "e-approval-booking", "e-booking-reply"].includes(
        edge.id,
      ),
  ),
};

export const googleReviewAssistantWorkflow: WorkflowDefinition = {
  id: "google-review-assistant-v1",
  name: "Google review assistant",
  version: 1,
  status: "draft",
  nodes: [
    {
      id: "google-review-event",
      kind: "trigger.google_review",
      label: "New Google review",
      description: "Starts when a new or updated review is received.",
      position: { x: 40, y: 190 },
      config: {
        connection: "Not connected",
        events: "New and updated reviews",
        locations: "All connected locations",
      },
    },
    {
      id: "review-risk-check",
      kind: "logic.review_risk",
      label: "Check rating and risk",
      description: "Flags low ratings and sensitive topics for the team.",
      position: { x: 310, y: 190 },
      config: {
        followUpBelowStars: 4,
        sensitiveTopics: "Safety, discrimination, legal threats, medical harm",
      },
    },
    {
      id: "review-business-knowledge",
      kind: "knowledge.search",
      label: "Find business context",
      description: "Finds approved facts that may help with the reply.",
      position: { x: 580, y: 60 },
      config: { sources: "Services, FAQs and documents", resultLimit: 4 },
    },
    {
      id: "review-draft",
      kind: "ai.respond",
      label: "Draft review reply",
      description: "Writes a personal, grounded reply in the reviewer’s language.",
      position: { x: 850, y: 60 },
      config: {
        model: "Managed for cost and quality",
        languages: "EN, FA, ZH",
        tone: "Warm and conversational",
      },
    },
    {
      id: "review-owner-approval",
      kind: "approval.owner",
      label: "Approve public reply",
      description: "A team member reviews the exact reply before it is posted.",
      position: { x: 1120, y: 60 },
      config: { timeoutMinutes: 1440, approvalFor: "Google review replies" },
    },
    {
      id: "google-review-reply",
      kind: "action.google_review_reply",
      label: "Post Google reply",
      description: "Posts or updates the business reply after approval.",
      position: { x: 1390, y: 60 },
      config: {
        provider: "Google Business Profile — not connected",
        mode: "approval_required",
      },
    },
    {
      id: "review-follow-up",
      kind: "handoff.review_follow_up",
      label: "Create follow-up task",
      description: "Creates a dashboard task for low-rating recovery or escalation.",
      position: { x: 580, y: 330 },
      config: {
        destination: "Dashboard inbox",
        dueHours: 24,
        rule: "Below 4 stars or sensitive topic",
      },
    },
    {
      id: "review-complete",
      kind: "output.review_complete",
      label: "Record outcome",
      description: "Records the approved reply and status in the audit trail.",
      position: { x: 1660, y: 60 },
      config: { status: "Reply posted", keepAuditTrail: true },
    },
  ],
  edges: [
    {
      id: "e-review-trigger-risk",
      source: "google-review-event",
      target: "review-risk-check",
    },
    {
      id: "e-review-risk-knowledge",
      source: "review-risk-check",
      target: "review-business-knowledge",
      label: "draft reply",
    },
    {
      id: "e-review-risk-follow-up",
      source: "review-risk-check",
      target: "review-follow-up",
      label: "low rating or sensitive",
    },
    {
      id: "e-review-knowledge-draft",
      source: "review-business-knowledge",
      target: "review-draft",
    },
    {
      id: "e-review-draft-approval",
      source: "review-draft",
      target: "review-owner-approval",
    },
    {
      id: "e-review-approval-post",
      source: "review-owner-approval",
      target: "google-review-reply",
      label: "approved",
    },
    {
      id: "e-review-post-complete",
      source: "google-review-reply",
      target: "review-complete",
    },
  ],
};

export const workflowTemplates: WorkflowTemplate[] = [
  {
    id: "salon-reception",
    name: "Salon reception",
    category: "Salon",
    description:
      "Answers service questions, prepares booking requests, and hands uncertain conversations to the team.",
    setupMinutes: 10,
    editableSummary:
      "Services, voice, languages, booking provider and approvals",
    workflow: salonReceptionWorkflow,
  },
  {
    id: "clinic-front-desk",
    name: "Clinic front desk",
    category: "Clinic",
    description:
      "Handles administrative questions and appointment requests while keeping medical questions with staff.",
    setupMinutes: 12,
    editableSummary:
      "Clinic information, languages, appointment rules and handoff",
    workflow: clinicFrontDeskWorkflow,
  },
  {
    id: "service-concierge",
    name: "Service business concierge",
    category: "Service business",
    description:
      "A lightweight website assistant for FAQs, services, multilingual replies and human follow-up.",
    setupMinutes: 8,
    editableSummary:
      "Business knowledge, response style, languages and handoff",
    workflow: serviceConciergeWorkflow,
  },
  {
    id: "google-review-assistant",
    name: "Google review assistant",
    category: "Reputation",
    description:
      "Drafts multilingual review replies, requires approval before posting, and flags low ratings for personal follow-up.",
    setupMinutes: 15,
    editableSummary:
      "Locations, reply voice, languages, risk rules and follow-up timing",
    workflow: googleReviewAssistantWorkflow,
  },
];

export function createWorkflowFromTemplate(
  templateId: string,
  workflowId: string,
): WorkflowDefinition | null {
  const template = workflowTemplates.find((item) => item.id === templateId);
  if (!template) return null;
  return {
    ...structuredClone(template.workflow),
    id: workflowId,
    name: template.name,
    version: 1,
    status: "draft",
  };
}
