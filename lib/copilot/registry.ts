import type { CopilotActionMeta } from "./contracts";
import { knowledgeActions } from "./actions/knowledge";
import { workflowActions } from "./actions/workflow";

/**
 * Every action the Copilot may take.
 *
 * The model chooses a name from this list and nothing else. It never names a
 * function, a table or a column: a tool call whose name is not here is
 * refused before anything runs, so a model that invents one achieves nothing.
 */
const ALL: readonly CopilotActionMeta[] = [
  ...knowledgeActions,
  ...workflowActions,
];

const BY_NAME = new Map(ALL.map((action) => [action.name, action]));

export function allCopilotActions(): readonly CopilotActionMeta[] {
  return ALL;
}

/** The action, or null when the name is not one we registered. */
export function findCopilotAction(name: string): CopilotActionMeta | null {
  return BY_NAME.get(name) ?? null;
}

/**
 * Catches a malformed action at startup rather than at the moment somebody
 * uses it, when the cost of a mistake is a real change to a real business.
 */
export function assertActionIsSound(action: CopilotActionMeta): void {
  const fail = (why: string) => {
    throw new Error(`Copilot action "${action.name}" ${why}.`);
  };

  // Bound straight through as a tool name, and OpenAI accepts only
  // [a-zA-Z0-9_-]. A dotted name fails the whole request at call time, which
  // is a long way from where the mistake was made.
  if (!/^[a-z][a-z0-9_]{2,63}$/.test(action.name))
    fail("needs a lower-case name a model provider will accept");
  if (!action.name.includes("_"))
    fail("needs a name shaped like domain_verb");
  if (!action.description.trim()) fail("needs a description");
  if (!action.audit.event.trim()) fail("needs an audit event");

  // A read cannot write, so it cannot change behaviour or need undoing.
  if (action.safety === "read_only") {
    if (action.affectsLiveBehaviour)
      fail("is read_only but claims to change live behaviour");
    if (action.supportsUndo) fail("is read_only but offers undo");
  }

  // A draft is not in use by anyone yet, by definition.
  if (action.safety === "draft_write" && action.affectsLiveBehaviour)
    fail("writes drafts but claims to change live behaviour");

  // Undo is a promise. Only make it where rollback is real, which these
  // levels cannot offer: a sent message and a deleted record do not come back.
  if (
    action.supportsUndo &&
    (action.safety === "external_write" || action.safety === "destructive")
  )
    fail("cannot honestly support undo at this safety level");

  // Viewers read. An action a viewer may run must not write anything.
  if (action.requiredRole === "viewer" && action.safety !== "read_only")
    fail("lets a viewer do more than read");
}

export function assertRegistryIsSound(): void {
  const seen = new Set<string>();
  for (const action of ALL) {
    if (seen.has(action.name))
      throw new Error(`Copilot action "${action.name}" is registered twice.`);
    seen.add(action.name);
    assertActionIsSound(action);
  }
}
