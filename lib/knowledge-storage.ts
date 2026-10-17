import type { BusinessProfile } from "./business";
import {
  createKnowledgeStoreFromBusiness,
  parseKnowledgeStore,
  type KnowledgeStore,
} from "./knowledge";

export const KNOWLEDGE_STORAGE_KEY = "hellocrew:knowledge:v1";

// Browser-local practice storage. Replaced by the tenant repository in Phase 1b.
export function readKnowledgeStore(business: BusinessProfile): KnowledgeStore {
  if (typeof window === "undefined")
    return createKnowledgeStoreFromBusiness(business);
  try {
    const raw = localStorage.getItem(KNOWLEDGE_STORAGE_KEY);
    if (!raw) return createKnowledgeStoreFromBusiness(business);
    const parsed = parseKnowledgeStore(JSON.parse(raw));
    return parsed.success
      ? parsed.data
      : createKnowledgeStoreFromBusiness(business);
  } catch {
    return createKnowledgeStoreFromBusiness(business);
  }
}
