import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { describeSource, searchApprovedKnowledge } from "@/lib/knowledge";
import type { AgentContext } from "./context";
import {
  assertContractIsSound,
  availableContracts,
  type IntegrationId,
  type ToolContract,
  type ToolEffect,
} from "./tool-contract";

export type { ToolEffect } from "./tool-contract";

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

/**
 * Every tool HelloCrew has, as contracts. Permissions travel with the tool:
 * there is no separate table of effects to forget to update.
 */
export function buildContracts(effects: TurnEffects): ToolContract[] {
  const searchKnowledge: ToolContract<z.ZodObject<{ query: z.ZodString }>> = {
    name: "search_knowledge",
    description:
      "Search the business's approved knowledge (FAQs, services, policies) and the documents the owner uploaded.",
    schema: z.object({ query: z.string().trim().min(1).max(200) }),
    effect: "read_only",
    scope: "tenant",
    approval: "none",
    requires: null,
    audit: { action: "knowledge.search", recordsPii: false },
    isEnabled: () => true,
    run: async ({ query }, context) => {
      const matches = searchApprovedKnowledge(context.knowledge, query);
      const lines = matches.map((m) =>
        describeSource(m.source, context.knowledge.team ?? []),
      );
      // Uploaded files the owner allowed, when the items don't cover it.
      if (matches.length < 2 && context.searchFiles) {
        const passages = await context.searchFiles(query).catch(() => []);
        for (const p of passages)
          lines.push(`From the document "${p.title}": ${p.content}`);
      }
      if (lines.length === 0) return "No approved information matches.";
      return lines.join("\n");
    },
  };

  const businessDetails: ToolContract<z.ZodObject<Record<string, never>>> = {
    name: "get_business_details",
    description:
      "Get opening hours, the service list with prices, and the booking link.",
    schema: z.object({}),
    effect: "read_only",
    scope: "tenant",
    approval: "none",
    requires: null,
    audit: { action: "business.read", recordsPii: false },
    isEnabled: () => true,
    run: (_args, context) =>
      JSON.stringify({
        name: context.business.name,
        hours: context.business.hours,
        services: context.business.services,
        bookingUrl: context.business.bookingUrl || null,
      }),
  };

  const requestBooking: ToolContract<
    z.ZodObject<{
      service: z.ZodString;
      preferredTime: z.ZodOptional<z.ZodString>;
      customerName: z.ZodOptional<z.ZodString>;
    }>
  > = {
    name: "request_booking",
    description:
      "Send a booking request to the business owner for approval. Use only when the customer clearly wants to book.",
    schema: z.object({
      service: z.string().trim().min(1).max(120),
      preferredTime: z.string().trim().max(120).optional(),
      customerName: z.string().trim().max(80).optional(),
    }),
    effect: "needs_approval",
    scope: "conversation",
    approval: "owner",
    requires: null,
    // One booking intent per service and time within a conversation: a retry
    // or a replayed approval resolves to the same key.
    idempotencyKey: ({ service, preferredTime }) =>
      `booking:${service.toLowerCase()}:${(preferredTime ?? "any").toLowerCase()}`,
    audit: { action: "booking.requested", recordsPii: true },
    isEnabled: (context) => context.skills.booking === "ask",
    run: ({ service, preferredTime, customerName }) => {
      if (effects.approvals.length >= 2)
        return "Too many booking requests in one turn. Ask the customer to confirm one.";
      effects.approvals.push({
        id: crypto.randomUUID(),
        kind: "booking",
        summary: `${service}${preferredTime ? `, ${preferredTime}` : ""}${customerName ? ` for ${customerName}` : ""}`,
        details: { service, preferredTime, customerName },
      });
      return JSON.stringify({
        status: "awaiting_owner_approval",
        note: "Tell the customer the request was sent and the business will confirm. Do not say it is booked.",
      });
    },
  };

  const handoff: ToolContract<z.ZodObject<{ reason: z.ZodString }>> = {
    name: "handoff_to_human",
    description:
      "Pass the conversation to a person at the business. Use for complaints, refunds, sensitive topics, or when asked.",
    schema: z.object({ reason: z.string().trim().min(1).max(200) }),
    effect: "internal_write",
    scope: "conversation",
    approval: "none",
    requires: null,
    idempotencyKey: () => "handoff",
    audit: { action: "conversation.handoff", recordsPii: false },
    isEnabled: (context) => context.skills.handoff === "auto",
    run: ({ reason }) => {
      effects.handoffs.push({ reason });
      return "A team member has been notified and will follow up.";
    },
  };

  const captureLead: ToolContract<
    z.ZodObject<{
      name: z.ZodString;
      email: z.ZodOptional<z.ZodString>;
      phone: z.ZodOptional<z.ZodString>;
      interest: z.ZodString;
    }>
  > = {
    name: "capture_lead",
    description:
      "Save a customer's name and phone or email so the team can follow up (a quote, a call back, or a question you couldn't answer). Only use details the customer gave in this conversation.",
    schema: z.object({
      name: z.string().trim().min(1).max(80),
      email: z.string().trim().max(254).optional(),
      phone: z.string().trim().max(40).optional(),
      interest: z
        .string()
        .trim()
        .min(1)
        .max(300)
        .describe("What they want, in a few words"),
    }),
    effect: "internal_write",
    scope: "conversation",
    approval: "none",
    requires: null,
    // One lead per conversation, so a retry cannot create a second record.
    idempotencyKey: () => "lead",
    audit: { action: "lead.captured", recordsPii: true },
    isEnabled: (context) => context.skills.leads === "auto",
    run: ({ name, email, phone, interest }) => {
      const cleanEmail = email?.trim().toLowerCase() || undefined;
      const cleanPhone =
        phone?.replace(/[^\d+()\-\s.]/g, "").trim() || undefined;
      if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail))
        return "That email address doesn't look complete. Ask the customer to check it.";
      if (cleanPhone && cleanPhone.replace(/\D/g, "").length < 7)
        return "That phone number looks too short. Ask the customer to check it.";
      if (!cleanEmail && !cleanPhone)
        return "Ask for a phone number or an email first.";
      if (effects.leads.length >= 1)
        return "Their details are already saved for this conversation.";
      effects.leads.push({
        id: crypto.randomUUID(),
        name,
        email: cleanEmail,
        phone: cleanPhone,
        interest,
      });
      return "Saved. Tell the customer the team will get back to them; don't promise a time.";
    },
  };

  const contracts = [
    searchKnowledge,
    businessDetails,
    requestBooking,
    handoff,
    captureLead,
  ] as ToolContract[];
  // Catches a malformed contract at build time rather than mid-conversation.
  for (const contract of contracts) assertContractIsSound(contract);
  return contracts;
}

/**
 * The contracts offered for this turn, keyed by name. The graph uses this to
 * decide what may run and how to describe it — there is no second source of
 * truth for a tool's effect.
 */
export function contractsForTurn(
  context: AgentContext,
  effects: TurnEffects,
  connectedIntegrations?: ReadonlySet<IntegrationId>,
  /** Contracts from a connected integration, e.g. the calendar tools. */
  extraContracts: ToolContract[] = [],
): Map<string, ToolContract> {
  const offered = availableContracts(
    [...buildContracts(effects), ...extraContracts],
    context,
    connectedIntegrations,
  );
  return new Map(offered.map((contract) => [contract.name, contract]));
}

/** LangChain tools derived from the contracts. Skills the owner switched off
 *  are not offered to the model at all. */
export function buildTools(
  context: AgentContext,
  effects: TurnEffects,
  connectedIntegrations?: ReadonlySet<IntegrationId>,
  extraContracts: ToolContract[] = [],
) {
  return [
    ...contractsForTurn(
      context,
      effects,
      connectedIntegrations,
      extraContracts,
    ).values(),
  ].map(
    (contract) =>
      tool(async (args) => String(await contract.run(args, context)), {
        name: contract.name,
        description: contract.description,
        schema: contract.schema,
      }),
  );
}

/** Effect lookup for a turn, derived from the contracts themselves. */
export function effectsByName(
  context: AgentContext,
  effects: TurnEffects,
  connectedIntegrations?: ReadonlySet<IntegrationId>,
  extraContracts: ToolContract[] = [],
): Record<string, ToolEffect> {
  const out: Record<string, ToolEffect> = {};
  for (const [name, contract] of contractsForTurn(
    context,
    effects,
    connectedIntegrations,
    extraContracts,
  ))
    out[name] = contract.effect;
  return out;
}
