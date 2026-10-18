import { z } from "zod";

// Shared (client + server) shapes for stored conversations.

export const threadStatuses = ["open", "waiting", "handoff", "closed"] as const;
export type ThreadStatus = (typeof threadStatuses)[number];
export type ThreadMode = "ai" | "human";
export type ThreadChannel = "test" | "website";

export type ThreadSummary = {
  id: string;
  channel: ThreadChannel;
  title: string;
  status: ThreadStatus;
  mode: ThreadMode;
  lastMessageAt: string;
  preview: string;
  messageCount: number;
};

export type StoredApproval = {
  id: string;
  conversationId: string;
  messageId: string | null;
  summary: string;
  status: "pending" | "approved" | "rejected" | "consumed";
  createdAt: string;
};

export const UNANSWERED_SOURCE = "No matching information";

const activitySchema = z
  .object({
    label: z.string().max(160),
    detail: z.string().max(600),
    kind: z.enum(["plan", "tool", "approval", "done", "error"]),
  })
  .strict();

// Message metadata the dashboard may store. Bounded so a browser can't
// write arbitrary blobs into the database.
export const messageMetaSchema = z
  .object({
    activity: z.array(activitySchema).max(12).optional(),
    source: z.string().max(160).optional(),
    unanswered: z.boolean().optional(),
    question: z.string().max(500).optional(),
    pendingId: z.string().max(100).optional(),
    usage: z
      .object({
        model: z.string().max(80),
        costMicroUsd: z.number().int().min(0),
        modelRounds: z.number().int().min(0).max(10),
      })
      .strict()
      .optional(),
    handoff: z.boolean().optional(),
    decision: z.enum(["approved", "rejected"]).optional(),
    approvalId: z.string().max(100).optional(),
  })
  .strict();
export type MessageMeta = z.infer<typeof messageMetaSchema>;

export const storedMessageSchema = z
  .object({
    id: z.string().uuid(),
    role: z.enum(["customer", "assistant", "owner"]),
    text: z.string().trim().min(1).max(4000),
    engine: z.enum(["practice", "live", "human"]).optional(),
    meta: messageMetaSchema.default({}),
  })
  .strict();
export type StoredMessageInput = z.input<typeof storedMessageSchema>;

export type StoredMessage = {
  id: string;
  role: "customer" | "assistant" | "owner";
  text: string;
  at: number;
  engine?: "practice" | "live" | "human";
  meta: MessageMeta;
};

export type NeedsYou = {
  approvals: (StoredApproval & { conversationTitle: string })[];
  unanswered: { question: string; conversationId: string; at: string }[];
  handoffs: { conversationId: string; title: string; at: string }[];
};

export function titleFrom(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "New conversation";
  return clean.length > 80 ? `${clean.slice(0, 77)}…` : clean;
}

// Status after an AI turn. A pending approval outranks a handoff; a person
// already in the conversation keeps it with them.
export function statusAfterTurn(input: {
  pendingApprovals: number;
  handoff: boolean;
  mode: ThreadMode;
}): ThreadStatus {
  if (input.pendingApprovals > 0) return "waiting";
  if (input.handoff || input.mode === "human") return "handoff";
  return "open";
}

export const statusLabel: Record<ThreadStatus, string> = {
  open: "AI handling",
  waiting: "Waiting for you",
  handoff: "Needs a person",
  closed: "Closed",
};

export const decisionReply = {
  approved:
    "Good news: the business approved your booking request. You’ll get a confirmation shortly.",
  rejected:
    "Sorry, the business couldn’t accept that booking request. Would another time work?",
} as const;
