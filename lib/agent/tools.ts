import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { describeSource, searchApprovedKnowledge } from "@/lib/knowledge";
import type { AgentContext } from "./context";

export type ToolEffect = "read_only" | "needs_approval" | "internal_write";

export type PendingApproval = {
  id: string;
  kind: "booking";
  summary: string;
  details: { service: string; preferredTime?: string; customerName?: string };
};

export type Handoff = { reason: string };

export type Lead = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  interest: string;
};

// Collected while the graph runs; returned to the caller with the reply.
export type TurnEffects = {
  approvals: PendingApproval[];
  handoffs: Handoff[];
  leads: Lead[];
};

export const toolEffects: Record<string, ToolEffect> = {
  search_knowledge: "read_only",
  get_business_details: "read_only",
  request_booking: "needs_approval",
  handoff_to_human: "internal_write",
  capture_lead: "internal_write",
};

export function buildTools(context: AgentContext, effects: TurnEffects) {
  const searchKnowledge = tool(
    async ({ query }) => {
      const matches = searchApprovedKnowledge(context.knowledge, query);
      const lines = matches.map((m) => describeSource(m.source, context.knowledge.team ?? []));
      // Uploaded files the owner allowed, when the items don't cover it.
      if (matches.length < 2 && context.searchFiles) {
        const passages = await context.searchFiles(query).catch(() => []);
        for (const p of passages) lines.push(`From the document "${p.title}": ${p.content}`);
      }
      if (lines.length === 0) return "No approved information matches.";
      return lines.join("\n");
    },
    {
      name: "search_knowledge",
      description:
        "Search the business's approved knowledge (FAQs, services, policies) and the documents the owner uploaded.",
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

  const captureLead = tool(
    async ({ name, email, phone, interest }) => {
      const cleanEmail = email?.trim().toLowerCase() || undefined;
      const cleanPhone = phone?.replace(/[^\d+()\-\s.]/g, "").trim() || undefined;
      if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail))
        return "That email address doesn't look complete. Ask the customer to check it.";
      if (cleanPhone && cleanPhone.replace(/\D/g, "").length < 7)
        return "That phone number looks too short. Ask the customer to check it.";
      if (!cleanEmail && !cleanPhone) return "Ask for a phone number or an email first.";
      if (effects.leads.length >= 1) return "Their details are already saved for this conversation.";
      effects.leads.push({ id: crypto.randomUUID(), name, email: cleanEmail, phone: cleanPhone, interest });
      return "Saved. Tell the customer the team will get back to them; don't promise a time.";
    },
    {
      name: "capture_lead",
      description:
        "Save a customer's name and phone or email so the team can follow up (a quote, a call back, or a question you couldn't answer). Only use details the customer gave in this conversation.",
      schema: z.object({
        name: z.string().trim().min(1).max(80),
        email: z.string().trim().max(254).optional(),
        phone: z.string().trim().max(40).optional(),
        interest: z.string().trim().min(1).max(300).describe("What they want, in a few words"),
      }),
    },
  );

  // Skills the owner switched off are not offered to the model at all.
  return [
    searchKnowledge,
    businessDetails,
    ...(context.skills.booking === "ask" ? [requestBooking] : []),
    ...(context.skills.handoff === "auto" ? [handoff] : []),
    ...(context.skills.leads === "auto" ? [captureLead] : []),
  ];
}
