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
import { toSearchQuery } from "@/lib/server/file-text";
import { buildAgentContext } from "./context";

// Builds the agent's context from the signed-in workspace (RLS-scoped reads).
// Nothing the browser sends is used as business knowledge.
export async function loadAgentContext(
  supabase: SupabaseClient,
  workspace: Pick<WorkspaceContext, "tenantId">,
) {
  const documents = await loadDocuments(supabase, workspace);
  const identity = assistantIdentitySchema.safeParse(
    documents.assistant_identity?.document,
  );
  const knowledge = parseKnowledgeStore(documents.knowledge?.document);
  const context = buildAgentContext(
    identity.success ? identity.data : sampleAssistantIdentity,
    knowledge.success
      ? knowledge.data
      : createKnowledgeStoreFromBusiness(sampleBusiness),
    new Date(),
    parseCrewStore(documents.crew?.document).members[0].skills,
  );
  context.searchFiles = async (question) => {
    const query = toSearchQuery(question);
    if (!query) return [];
    const { data } = await supabase.rpc("hc_search_file_chunks", {
      p_tenant_id: workspace.tenantId,
      p_query: query,
      p_limit: 3,
    });
    return ((data ?? []) as { title: string; content: string }[]).map((row) => ({
      title: row.title,
      content: row.content,
    }));
  };
  return context;
}
