import { describe, expect, it } from "vitest";

import type { LiveAiStatus } from "@/app/app/actions";
import { operatingMode } from "@/components/dashboard/operating-mode";
import type { Account } from "@/components/dashboard/workspace-sync";

const signedIn: Account = {
  status: "signed_in",
  email: "owner@example.com",
  workspaceName: "Studio",
  role: "owner",
};
const signedOut: Account = { status: "signed_out" };

const ready = (enabled: boolean): LiveAiStatus => ({
  state: "ready",
  enabled,
  canManage: true,
  model: "gpt-test",
  budgetMicroUsd: 5_000_000,
  spentMicroUsd: 0,
});
const liveReady = ready(true);
const liveOff = ready(false);
const liveMissing: LiveAiStatus = {
  state: "not_configured",
  missing: ["openai_key"],
};

describe("operatingMode", () => {
  it("calls a signed-out visitor guest practice", () => {
    const mode = operatingMode({
      account: signedOut,
      engine: "practice",
      live: null,
    });
    expect(mode.id).toBe("guest_practice");
    expect(mode.billable).toBe(false);
  });

  it("calls a signed-in practice session practice", () => {
    const mode = operatingMode({
      account: signedIn,
      engine: "practice",
      live: liveReady,
    });
    expect(mode.id).toBe("practice");
    expect(mode.label).toBe("Practice");
    expect(mode.billable).toBe(false);
  });

  it("reports Live AI only when it is ready and switched on", () => {
    const mode = operatingMode({
      account: signedIn,
      engine: "live",
      live: liveReady,
    });
    expect(mode.id).toBe("live");
    expect(mode.billable).toBe(true);
  });

  it("never claims replies are free while Live AI is selected and working", () => {
    const mode = operatingMode({
      account: signedIn,
      engine: "live",
      live: liveReady,
    });
    expect(mode.detail).not.toMatch(/no ai model is called/i);
    expect(mode.detail).not.toMatch(/no paid ai calls/i);
    expect(mode.detail).toMatch(/budget/i);
  });

  it("says Live AI is unavailable when selected but switched off", () => {
    const mode = operatingMode({
      account: signedIn,
      engine: "live",
      live: liveOff,
    });
    expect(mode.id).toBe("live_unavailable");
    expect(mode.billable).toBe(false);
    expect(mode.detail).toMatch(/saved answers/i);
  });

  it("says Live AI is unavailable when it was never configured", () => {
    const mode = operatingMode({
      account: signedIn,
      engine: "live",
      live: liveMissing,
    });
    expect(mode.id).toBe("live_unavailable");
    expect(mode.detail).toMatch(/not set up/i);
  });

  it("puts human takeover ahead of every other mode", () => {
    for (const live of [liveReady, liveOff, null]) {
      for (const engine of ["practice", "live"] as const) {
        const mode = operatingMode({
          account: signedIn,
          engine,
          live,
          conversationMode: "human",
        });
        expect(mode.id).toBe("human");
        expect(mode.billable).toBe(false);
      }
    }
  });

  it("distinguishes a real channel from a test chat when live", () => {
    const test = operatingMode({
      account: signedIn,
      engine: "live",
      live: liveReady,
      channel: "test",
    });
    const real = operatingMode({
      account: signedIn,
      engine: "live",
      live: liveReady,
      channel: "whatsapp",
    });
    expect(test.detail).toMatch(/nothing reaches a customer/i);
    expect(real.detail).toMatch(/real customers/i);
  });

  it("gives every mode a label and a detail", () => {
    const seen = new Set<string>();
    for (const account of [signedOut, signedIn]) {
      for (const engine of ["practice", "live"] as const) {
        for (const live of [null, liveReady, liveOff, liveMissing]) {
          const mode = operatingMode({ account, engine, live });
          expect(mode.label.length).toBeGreaterThan(0);
          expect(mode.detail.length).toBeGreaterThan(0);
          seen.add(mode.id);
        }
      }
    }
    expect(seen).toContain("guest_practice");
    expect(seen).toContain("practice");
    expect(seen).toContain("live");
    expect(seen).toContain("live_unavailable");
  });
});
