import {
  ASSISTANT_IDENTITY_STORAGE_KEY,
  assistantIdentitySchema,
} from "./assistant";
import { CREW_STORAGE_KEY, crewStoreSchema } from "./crew";
import { parseKnowledgeStore } from "./knowledge";
import { KNOWLEDGE_STORAGE_KEY } from "./knowledge-storage";
import { parseWorkflowStore } from "./workflow-lifecycle";
import { WORKFLOW_STORAGE_KEY } from "./workflow-readiness";

// Documents the dashboard editors save. Each maps to one browser storage key
// and one row in public.hc_workspace_documents for signed-in owners.
export const workspaceDocumentKeys = [
  "assistant_identity",
  "knowledge",
  "workflows",
  "crew",
] as const;
export type WorkspaceDocumentKey = (typeof workspaceDocumentKeys)[number];

export const localStorageKeyFor: Record<WorkspaceDocumentKey, string> = {
  assistant_identity: ASSISTANT_IDENTITY_STORAGE_KEY,
  knowledge: KNOWLEDGE_STORAGE_KEY,
  workflows: WORKFLOW_STORAGE_KEY,
  crew: CREW_STORAGE_KEY,
};

export const MAX_DOCUMENT_BYTES = 400_000;

export function isWorkspaceDocumentKey(
  value: unknown,
): value is WorkspaceDocumentKey {
  return workspaceDocumentKeys.includes(value as WorkspaceDocumentKey);
}

// Validates a document before it is stored. Returns the normalized document or null.
export function validateWorkspaceDocument(
  key: WorkspaceDocumentKey,
  document: unknown,
): unknown | null {
  try {
    if (JSON.stringify(document).length > MAX_DOCUMENT_BYTES) return null;
  } catch {
    return null;
  }
  if (key === "assistant_identity") {
    const parsed = assistantIdentitySchema.safeParse(document);
    return parsed.success ? parsed.data : null;
  }
  if (key === "knowledge") {
    const parsed = parseKnowledgeStore(document);
    return parsed.success ? parsed.data : null;
  }
  if (key === "crew") {
    const parsed = crewStoreSchema.safeParse(document);
    return parsed.success ? parsed.data : null;
  }
  if (!document || typeof document !== "object") return null;
  const store = parseWorkflowStore(document);
  const submitted = (document as { workflows?: unknown }).workflows;
  // Reject rather than silently drop records that fail validation.
  if (!Array.isArray(submitted) || submitted.length !== store.workflows.length)
    return null;
  return store;
}

export const LOCAL_WRITE_EVENT = "hellocrew:local-write";

/**
 * A workspace document changed on the server and this browser has taken the
 * new copy.
 *
 * Deliberately not LOCAL_WRITE_EVENT: that one means "this browser edited
 * something, push it up". Announcing a pull with it would send the server's
 * own copy straight back, and anything listening would have to guess which
 * direction the change came from.
 */
export const WORKSPACE_PULLED_EVENT = "hellocrew:workspace-pulled";

export function announcePulled(key: WorkspaceDocumentKey) {
  window.dispatchEvent(
    new CustomEvent(WORKSPACE_PULLED_EVENT, { detail: { key } }),
  );
}

// Editors call this instead of localStorage.setItem so the dashboard can sync
// the change to the signed-in workspace.
export function persistLocal(key: WorkspaceDocumentKey, value: unknown) {
  try {
    localStorage.setItem(localStorageKeyFor[key], JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new CustomEvent(LOCAL_WRITE_EVENT, { detail: { key } }));
}
