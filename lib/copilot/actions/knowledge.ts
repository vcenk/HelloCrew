import { z } from "zod";

import type { CopilotActionMeta } from "../contracts";

/**
 * What the Copilot may do with knowledge.
 *
 * Metadata only, so the panel can import it: the code that reads a document
 * or writes to the store lives in lib/server/copilot/actions.
 *
 * Reading, drafting and approving are three actions rather than one with a
 * flag. A single action whose safety level depended on its input would be an
 * action the model could talk down to the harmless level.
 */

export const searchKnowledge: CopilotActionMeta<
  z.ZodObject<{ query: z.ZodString }>
> = {
  name: "knowledge_search",
  description:
    "Look through the business's approved knowledge and report what is there. Use before claiming something is or is not already known.",
  input: z.object({
    query: z.string().trim().min(1).max(200),
  }),
  safety: "read_only",
  requiredRole: "viewer",
  resource: "knowledge",
  requires: null,
  // Reading changes nothing, so it cannot change what the crew does.
  affectsLiveBehaviour: false,
  supportsUndo: false,
  audit: { event: "copilot.knowledge.search", recordsPii: false },
};

export const addKnowledgeFromDocument: CopilotActionMeta<
  z.ZodObject<{ fileId: z.ZodString }>
> = {
  name: "knowledge_add_from_document",
  description:
    "Read an attached document and propose knowledge items from it. Items arrive as drafts; they do not become approved knowledge here.",
  input: z.object({
    fileId: z.string().uuid(),
  }),
  safety: "draft_write",
  requiredRole: "operator",
  resource: "knowledge_file",
  requires: null,
  // Drafts sit beside approved knowledge without being used by anyone.
  affectsLiveBehaviour: false,
  // Removing the drafts this added puts the store back as it was.
  supportsUndo: true,
  audit: { event: "copilot.knowledge.drafted", recordsPii: true },
};

export const approveKnowledgeItems: CopilotActionMeta<
  z.ZodObject<{ sourceIds: z.ZodArray<z.ZodString> }>
> = {
  name: "knowledge_approve_items",
  description:
    "Turn specific draft knowledge items into approved knowledge the crew may use. Only ever at the owner's explicit instruction.",
  input: z.object({
    sourceIds: z.array(z.string().min(1).max(120)).min(1).max(100),
  }),
  safety: "live_configuration",
  requiredRole: "operator",
  resource: "knowledge",
  requires: null,
  // This is the step where a customer can be told something new.
  affectsLiveBehaviour: true,
  supportsUndo: true,
  audit: { event: "copilot.knowledge.approved", recordsPii: true },
};

export const knowledgeActions = [
  searchKnowledge,
  addKnowledgeFromDocument,
  approveKnowledgeItems,
] as const;
