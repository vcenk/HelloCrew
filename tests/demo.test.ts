import { describe, expect, it, vi } from "vitest";
import {
  runDemo,
  faqTool,
  quoteTool,
  requestSchema,
  MAX_TURNS,
  type DemoSession,
} from "../lib/demo";
const fresh = (): DemoSession => ({
  id: crypto.randomUUID(),
  turn: 0,
  approvals: [],
});
describe("structured sample tools", () => {
  it("rejects unapproved FAQ subjects", async () => {
    await expect(
      faqTool.invoke({
        name: "lookup_faq",
        type: "tool_call",
        id: "invalid",
        args: { topic: "passwords" },
      }),
    ).rejects.toThrow();
  });
  it("rejects invalid prices and quantities", async () => {
    await expect(
      quoteTool.invoke({ service: "studio-visit", quantity: -1 }),
    ).rejects.toThrow();
    await expect(
      quoteTool.invoke({
        name: "calculate_quote",
        type: "tool_call",
        id: "invalid",
        args: { service: "private-service", quantity: 1 },
      }),
    ).rejects.toThrow();
  });
  it("calculates only a fictional catalog quote", async () => {
    const r = await runDemo({ session: fresh(), scenario: "quote" });
    expect(r.reply).toContain("$40 USD");
    expect(r.reply).toContain("fictional");
    expect(r.activity.map((a) => a.kind)).toEqual(["plan", "tool", "done"]);
  });
  it("consumes the FAQ tool result", async () => {
    const r = await runDemo({ session: fresh(), scenario: "hours" });
    expect(r.reply).toContain("Monday–Friday");
    expect(r.session.turn).toBe(1);
  });
  it("prepares a handoff without sending anything", async () => {
    const r = await runDemo({ session: fresh(), scenario: "handoff" });
    expect(r.reply).toContain("nobody is contacted");
  });
});
describe("disposable demo approvals", () => {
  it("does not approve or book on preparation", async () => {
    const r = await runDemo({ session: fresh(), scenario: "booking" });
    expect(r.session.approvals[0].status).toBe("pending");
    expect(r.pendingId).toBeTruthy();
    expect(r.reply).toContain("does not reserve");
  });
  it("isolates decision IDs to the matching demo session", async () => {
    const a = await runDemo({ session: fresh(), scenario: "booking" });
    const b = await runDemo({ session: fresh(), scenario: "booking" });
    await expect(
      runDemo({
        session: b.session,
        decision: { id: a.pendingId, value: "approve" },
      }),
    ).rejects.toThrow("does not belong");
  });
  it("rejects copied records with a mismatched session owner", async () => {
    const a = await runDemo({ session: fresh(), scenario: "booking" });
    await expect(
      runDemo({
        session: { ...fresh(), approvals: a.session.approvals },
        decision: { id: a.pendingId, value: "approve" },
      }),
    ).rejects.toThrow();
  });
  it("makes repeated decisions idempotent within returned demo state", async () => {
    const a = await runDemo({ session: fresh(), scenario: "booking" });
    const b = await runDemo({
      session: a.session,
      decision: { id: a.pendingId, value: "approve" },
    });
    const c = await runDemo({
      session: b.session,
      decision: { id: a.pendingId, value: "approve" },
    });
    expect(c.session).toEqual(b.session);
    expect(c.reply).toContain("already approved");
  });
  it("does not turn a rejected request into approval", async () => {
    const a = await runDemo({ session: fresh(), scenario: "booking" });
    const b = await runDemo({
      session: a.session,
      decision: { id: a.pendingId, value: "reject" },
    });
    const c = await runDemo({
      session: b.session,
      decision: { id: a.pendingId, value: "approve" },
    });
    expect(c.session.approvals[0].status).toBe("rejected");
    expect(c.reply).toContain("already rejected");
  });
  it("does not mutate the caller state", async () => {
    const a = await runDemo({ session: fresh(), scenario: "booking" });
    await runDemo({
      session: a.session,
      decision: { id: a.pendingId, value: "reject" },
    });
    expect(a.session.approvals[0].status).toBe("pending");
  });
});
describe("bounded demo only input", () => {
  it("caps practice turns", async () => {
    await expect(
      runDemo({ session: { ...fresh(), turn: MAX_TURNS }, scenario: "hours" }),
    ).rejects.toThrow("turn limit");
  });
  it("rejects arbitrary free text or mixed decisions", () => {
    expect(
      requestSchema.safeParse({
        session: fresh(),
        message: "private information",
      }).success,
    ).toBe(false);
    expect(
      requestSchema.safeParse({
        session: fresh(),
        scenario: "hours",
        decision: { id: "x", value: "approve" },
      }).success,
    ).toBe(false);
  });
  it("rejects malformed state", async () => {
    await expect(
      runDemo({ session: { ...fresh(), turn: -1 }, scenario: "hours" }),
    ).rejects.toThrow();
  });
});

describe("external tracing guard", () => {
  it.each([
    "LANGSMITH_TRACING",
    "LANGCHAIN_TRACING_V2",
    "LANGCHAIN_TRACING",
    "LANGCHAIN_VERBOSE",
  ])("fails closed if %s is enabled in the host environment", async (flag) => {
    vi.stubEnv(flag, "true");
    try {
      await expect(
        runDemo({ session: fresh(), scenario: "hours" }),
      ).rejects.toThrow("External tracing must be disabled");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("approval after scenario cap", () => {
  it("can resolve a request created on the final practice turn", async () => {
    const a = await runDemo({
      session: { ...fresh(), turn: MAX_TURNS - 1 },
      scenario: "booking",
    });
    const b = await runDemo({
      session: a.session,
      decision: { id: a.pendingId, value: "approve" },
    });
    expect(b.session.approvals[0].status).toBe("approved");
    expect(b.session.turn).toBe(MAX_TURNS);
  });
});
