import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { searchApprovedKnowledge } from "@/lib/knowledge";
import type { AgentContext } from "./context";

export type ToolEffect = "read_only" | "needs_approval" | "internal_write";

export type PendingApproval = {
  id: string;
  kind: "booking";
  summary: string;
  details: { service: string; preferredTime?: string; customerName?: string };
};

export type Handoff = { reason: string };

// Collected while the graph runs; returned to the caller with the reply.
export type TurnEffects = {
  approvals: PendingApproval[];
  handoffs: Handoff[];
};

export const toolEffects: Record<string, ToolEffect> = {
  search_knowledge: "read_only",
  get_business_details: "read_only",
  request_booking: "needs_approval",
  handoff_to_human: "internal_write",
};

export function buildTools(context: AgentContext, effects: TurnEffects) {
  const searchKnowledge = tool(
    async ({ query }) => {
      const matches = searchApprovedKnowledge(context.knowledge, query);
      if (matches.length === 0) return "No approved information matches.";
      return matches
        .map(
          (m) =>
            `${m.source.title}${m.source.price ? ` (${m.source.price})` : ""}: ${m.source.content}`,
        )
        .join("\n");
    },
    {
      name: "search_knowledge",
      description:
        "Search the business's approved knowledge (FAQs, services, policies, documents).",
      schema: z.object({ query: z.string().trim().min(1).max(200) }),
    },
  );

  const businessDetails = tool(
    async () =>
      JSON.stringify({
        name: context.business.name,
        hours: context.business.hours,
        services: context.business.services,
        bookingUrl: context.business.bookingUrl || null,
      }),
    {
      name: "get_business_details",
      description:
        "Get opening hours, the service list with prices, and the booking link.",
      schema: z.object({}),
    },
  );

  const requestBooking = tool(
    async ({ service, preferredTime, customerName }) => {
      if (effects.approvals.length >= 2)
        return "Too many booking requests in one turn. Ask the customer to confirm one.";
      const approval: PendingApproval = {
        id: crypto.randomUUID(),
        kind: "booking",
        summary: `${service}${preferredTime ? `, ${preferredTime}` : ""}${customerName ? ` for ${customerName}` : ""}`,
        details: { service, preferredTime, customerName },
      };
      effects.approvals.push(approval);
      return JSON.stringify({
        status: "awaiting_owner_approval",
        note: "Tell the customer the request was sent and the business will confirm. Do not say it is booked.",
      });
    },
    {
      name: "request_booking",
      description:
        "Send a booking request to the business owner for approval. Use only when the customer clearly wants to book.",
      schema: z.object({
        service: z.string().trim().min(1).max(120),
        preferredTime: z.string().trim().max(120).optional(),
        customerName: z.string().trim().max(80).optional(),
      }),
    },
  );

  const handoff = tool(
    async ({ reason }) => {
      effects.handoffs.push({ reason });
      return "A team member has been notified and will follow up.";
    },
    {
      name: "handoff_to_human",
      description:
        "Pass the conversation to a person at the business. Use for complaints, refunds, sensitive topics, or when asked.",
      schema: z.object({ reason: z.string().trim().min(1).max(200) }),
    },
  );

  return [searchKnowledge, businessDetails, requestBooking, handoff];
}
