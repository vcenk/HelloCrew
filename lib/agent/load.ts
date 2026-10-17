import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  assistantIdentitySchema,
  sampleAssistantIdentity,
} from "@/lib/assistant";
import { sampleBusiness } from "@/lib/business";
import { loadDocuments, type WorkspaceContext } from "@/lib/data/workspace";
import {
  createKnowledgeStoreFromBusiness,
  parseKnowledgeStore,
} from "@/lib/knowledge";
import { parseCrewStore } from "@/lib/crew";
import { buildAgentContext } from "./context";

// Builds the agent's context from the signed-in workspace (RLS-scoped reads).
// Nothing the browser sends is used as business knowledge.
export async function loadAgentContext(
  supabase: SupabaseClient,
  workspace: WorkspaceContext,
) {
  const documents = await loadDocuments(supabase, workspace);
  const identity = assistantIdentitySchema.safeParse(
    documents.assistant_identity?.document,
  );
  const knowledge = parseKnowledgeStore(documents.knowledge?.document);
  return buildAgentContext(
    identity.success ? identity.data : sampleAssistantIdentity,
    knowledge.success
      ? knowledge.data
      : createKnowledgeStoreFromBusiness(sampleBusiness),
    new Date(),
    parseCrewStore(documents.crew?.document).members[0].skills,
  );
}
