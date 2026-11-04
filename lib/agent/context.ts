import type { AssistantIdentity } from "@/lib/assistant";
import type { BusinessProfile } from "@/lib/business";
import { defaultCrew, type CrewMember } from "@/lib/crew";
import {
  businessFromKnowledge,
  type KnowledgeKind,
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
  /**
   * Set by a published workflow governing this conversation. Both narrow:
   * `tone` replaces the assistant's voice, `knowledgeKinds` restricts which
   * approved knowledge it may use. Absent means the assistant's own settings
   * apply, which is the ordinary case.
   */
  tone?: string;
  knowledgeKinds?: ReadonlySet<KnowledgeKind>;
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
