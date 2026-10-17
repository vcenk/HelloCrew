import type { AssistantIdentity } from "@/lib/assistant";
import type { BusinessProfile } from "@/lib/business";
import {
  businessFromKnowledge,
  type KnowledgeSource,
  type KnowledgeStore,
} from "@/lib/knowledge";

export type AgentContext = {
  identity: AssistantIdentity;
  knowledge: KnowledgeStore;
  business: BusinessProfile;
  approvedSources: KnowledgeSource[];
  now: Date;
};

export function buildAgentContext(
  identity: AssistantIdentity,
  knowledge: KnowledgeStore,
  now = new Date(),
): AgentContext {
  return {
    identity,
    knowledge,
    business: businessFromKnowledge(knowledge),
    approvedSources: knowledge.sources.filter((s) => s.status === "approved"),
    now,
  };
}
