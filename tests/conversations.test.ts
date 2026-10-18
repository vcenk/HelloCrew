import { describe, expect, it } from "vitest";

import {
  messageMetaSchema,
  statusAfterTurn,
  storedMessageSchema,
  titleFrom,
} from "../lib/conversations";

describe("stored conversations", () => {
  it("puts pending approvals ahead of handoffs", () => {
    expect(statusAfterTurn({ pendingApprovals: 1, handoff: true, mode: "ai" })).toBe("waiting");
    expect(statusAfterTurn({ pendingApprovals: 0, handoff: true, mode: "ai" })).toBe("handoff");
    expect(statusAfterTurn({ pendingApprovals: 0, handoff: false, mode: "human" })).toBe("handoff");
    expect(statusAfterTurn({ pendingApprovals: 0, handoff: false, mode: "ai" })).toBe("open");
  });

  it("titles a chat from its first message", () => {
    expect(titleFrom("  Do you   have wifi? ")).toBe("Do you have wifi?");
    expect(titleFrom("")).toBe("New conversation");
    expect(titleFrom("x".repeat(200))).toHaveLength(78);
  });

  it("rejects unknown or oversized metadata from the browser", () => {
    expect(messageMetaSchema.safeParse({ unanswered: true, question: "wifi?" }).success).toBe(true);
    expect(messageMetaSchema.safeParse({ admin: true }).success).toBe(false);
    expect(messageMetaSchema.safeParse({ question: "q".repeat(501) }).success).toBe(false);
    expect(
      messageMetaSchema.safeParse({
        activity: Array.from({ length: 13 }, () => ({ label: "a", detail: "b", kind: "done" })),
      }).success,
    ).toBe(false);
  });

  it("only accepts known roles and engines", () => {
    const base = { id: crypto.randomUUID(), text: "hi" };
    expect(storedMessageSchema.safeParse({ ...base, role: "customer", engine: "practice" }).success).toBe(true);
    expect(storedMessageSchema.safeParse({ ...base, role: "system" }).success).toBe(false);
    expect(storedMessageSchema.safeParse({ ...base, role: "owner", engine: "gpt" }).success).toBe(false);
  });
});
