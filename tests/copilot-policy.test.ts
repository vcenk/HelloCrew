import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  needsConfirmation,
  roleAllows,
  safetyLevels,
  type CopilotActionMeta,
} from "../lib/copilot/contracts";
import { decideCopilotAction } from "../lib/copilot/policy";
import {
  allCopilotActions,
  assertActionIsSound,
  assertRegistryIsSound,
  findCopilotAction,
} from "../lib/copilot/registry";

const sound: CopilotActionMeta = {
  name: "knowledge_search",
  description: "x",
  input: z.object({}),
  safety: "read_only",
  requiredRole: "viewer",
  resource: "knowledge",
  requires: null,
  affectsLiveBehaviour: false,
  supportsUndo: false,
  audit: { event: "e", recordsPii: false },
};

describe("the registry is the only thing the model can reach", () => {
  it("every registered action is sound", () => {
    expect(() => assertRegistryIsSound()).not.toThrow();
    expect(allCopilotActions().length).toBeGreaterThan(0);
  });

  it.each([
    "knowledge.delete_everything",
    "sql",
    "",
    "eval",
    "knowledge.search ",
  ])("refuses the unregistered name %s", (name) => {
    expect(findCopilotAction(name)).toBeNull();
    const decision = decideCopilotAction({
      name,
      role: "owner",
      connected: new Set(),
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe("unknown_action");
  });

  it.each(["knowledge.search", "Knowledge_Search", "ns", "knowledge search"])(
    "refuses the unusable action name %s",
    (name) => {
      // A name is bound straight through as a tool name. OpenAI accepts only
      // [a-zA-Z0-9_-], and a dotted one fails the whole request at call time
      // — a long way from where the mistake was made.
      expect(() => assertActionIsSound({ ...sound, name })).toThrow();
    },
  );

  it("refuses a read_only action that claims to change behaviour", () => {
    expect(() =>
      assertActionIsSound({ ...sound, affectsLiveBehaviour: true }),
    ).toThrow(/live behaviour/i);
  });

  it("refuses a draft action that claims to change behaviour", () => {
    // A draft nobody has approved is not in use, by definition.
    expect(() =>
      assertActionIsSound({
        ...sound,
        safety: "draft_write",
        requiredRole: "operator",
        affectsLiveBehaviour: true,
      }),
    ).toThrow(/live behaviour/i);
  });

  it.each(["external_write", "destructive"] as const)(
    "refuses undo on a %s action",
    (safety) => {
      // Undo is a promise. A sent message and a deleted record do not return.
      expect(() =>
        assertActionIsSound({
          ...sound,
          safety,
          requiredRole: "owner",
          affectsLiveBehaviour: true,
          supportsUndo: true,
        }),
      ).toThrow(/undo/i);
    },
  );

  it("refuses an action that lets a viewer write", () => {
    expect(() =>
      assertActionIsSound({
        ...sound,
        safety: "live_configuration",
        requiredRole: "viewer",
        affectsLiveBehaviour: true,
      }),
    ).toThrow(/viewer/i);
  });
});

describe("the gate between a tool call and anything happening", () => {
  const connected = new Set<string>();

  it("lets an owner run a registered action", () => {
    const decision = decideCopilotAction({
      name: "knowledge_add_from_document",
      role: "owner",
      connected,
    });
    expect(decision.allowed).toBe(true);
  });

  it("refuses a viewer anything that writes", () => {
    const decision = decideCopilotAction({
      name: "knowledge_add_from_document",
      role: "viewer",
      connected,
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe("forbidden");
  });

  it("still lets a viewer read", () => {
    expect(
      decideCopilotAction({
        name: "knowledge_search",
        role: "viewer",
        connected,
      }).allowed,
    ).toBe(true);
  });

  it("takes the safety level from the registry, not the caller", () => {
    // The whole point: a model that could name its own level would name the
    // harmless one.
    const decision = decideCopilotAction({
      name: "knowledge_approve_items",
      role: "owner",
      connected,
    });
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.safety).toBe("live_configuration");
      expect(decision.confirm).toBe(true);
    }
  });

  it("refuses a name that is close to a real one", () => {
    // Near-misses are the interesting case: they look registered.
    for (const name of [
      "knowledge.approve_item",
      "knowledge.approveItems",
      "Knowledge.approve_items",
    ])
      expect(
        decideCopilotAction({ name, role: "owner", connected }).allowed,
        name,
      ).toBe(false);
  });
});

describe("which levels may run without asking", () => {
  it.each(["read_only", "draft_write"] as const)(
    "%s runs immediately",
    (level) => {
      expect(needsConfirmation(level)).toBe(false);
    },
  );

  it.each(["live_configuration", "external_write", "destructive"] as const)(
    "%s must be confirmed",
    (level) => {
      expect(needsConfirmation(level)).toBe(true);
    },
  );

  it("covers every level that exists", () => {
    // A level added later without a decision here would otherwise default to
    // "ask", which is safe, but silently — this makes it deliberate.
    for (const level of safetyLevels)
      expect(typeof needsConfirmation(level)).toBe("boolean");
    expect(safetyLevels).toHaveLength(5);
  });
});

describe("roles", () => {
  it("ranks owner above operator above viewer", () => {
    expect(roleAllows("owner", "operator")).toBe(true);
    expect(roleAllows("operator", "operator")).toBe(true);
    expect(roleAllows("operator", "owner")).toBe(false);
    expect(roleAllows("viewer", "operator")).toBe(false);
    expect(roleAllows("viewer", "viewer")).toBe(true);
  });
});
