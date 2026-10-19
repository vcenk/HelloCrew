import type { AssistantIdentity } from "@/lib/assistant";
import type { BusinessProfile } from "@/lib/business";
import { defaultCrew, type CrewMember } from "@/lib/crew";
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
  skills: CrewMember["skills"];
  now: Date;
  // Full-text search over uploaded files the owner allowed (server only).
  searchFiles?: (question: string) => Promise<{ title: string; content: string }[]>;
};

export function buildAgentContext(
  identity: AssistantIdentity,
  knowledge: KnowledgeStore,
  now = new Date(),
  skills: CrewMember["skills"] = defaultCrew.members[0].skills,
): AgentContext {
  return {
    skills,
    identity,
    knowledge,
    business: businessFromKnowledge(knowledge),
    approvedSources: knowledge.sources.filter((s) => s.status === "approved"),
    now,
  };
}
