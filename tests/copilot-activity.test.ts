import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAGE,
  MAX_PAGE,
  pageSize,
  toActivityEntries,
} from "../lib/server/copilot/activity";
import type { CopilotAuditEvent } from "../lib/server/copilot/audit";

/**
 * What the owner's activity panel is allowed to show.
 *
 * Two things are worth guarding. The page size arrives from a browser, so it
 * has to survive anything being passed. And the stored row carries the
 * actor's user id, which the page does not need: the owner needs to know
 * whether an action was theirs, not to receive a uuid.
 */

const stored: CopilotAuditEvent = {
  event: "workflow.published",
  tenantId: "tenant-1",
  userId: "user-1",
  role: "owner",
  action: "publish_workflow",
  safety: "live_configuration",
  resource: "workflow",
  outcome: "applied",
  applied: 3,
  skipped: 1,
  at: "2026-11-11T09:00:00.000Z",
};

/** Exactly the fields an activity line may carry. */
const ALLOWED = [
  "event",
  "action",
  "resource",
  "safety",
  "outcome",
  "applied",
  "skipped",
  "reason",
  "at",
  "byYou",
  "role",
].sort();

describe("bounding the page size", () => {
  it("falls back to the default for anything that is not a number", () => {
    for (const value of [undefined, null, "50", {}, [], NaN, Infinity])
      expect(pageSize(value)).toBe(DEFAULT_PAGE);
  });

  it("never returns more than the maximum", () => {
    expect(pageSize(1_000_000)).toBe(MAX_PAGE);
    expect(pageSize(MAX_PAGE + 1)).toBe(MAX_PAGE);
  });

  it("never returns less than one", () => {
    expect(pageSize(0)).toBe(1);
    expect(pageSize(-40)).toBe(1);
  });

  it("truncates a fractional page size to a whole number of rows", () => {
    expect(pageSize(10.9)).toBe(10);
  });

  it("passes a sensible request through unchanged", () => {
    expect(pageSize(25)).toBe(25);
  });
});

describe("turning stored rows into activity lines", () => {
  it("carries the action, resource and outcome across", () => {
    const [entry] = toActivityEntries([stored], "user-1");
    expect(entry).toMatchObject({
      event: "workflow.published",
      action: "publish_workflow",
      resource: "workflow",
      safety: "live_configuration",
      outcome: "applied",
      applied: 3,
      skipped: 1,
      at: "2026-11-11T09:00:00.000Z",
      role: "owner",
    });
  });

  it("never sends the actor's user id to the browser", () => {
    // The check that matters. The stored row has a user id and a tenant id;
    // neither belongs in a page, and `byYou` is what the owner actually
    // needs. A future field added to the entry fails here.
    //
    // Every optional field is populated, or the comparison would pass for
    // the wrong reason — an absent `reason` would make the key list short
    // and the equality check would be asserting the fixture, not the rule.
    const [entry] = toActivityEntries(
      [{ ...stored, reason: "forbidden" }],
      "user-1",
    );
    expect(Object.keys(entry!).sort()).toEqual(ALLOWED);
    expect(entry).not.toHaveProperty("userId");
    expect(entry).not.toHaveProperty("tenantId");
  });

  it("marks the viewer's own actions as theirs", () => {
    expect(toActivityEntries([stored], "user-1")[0]!.byYou).toBe(true);
  });

  it("does not claim someone else's action was the viewer's", () => {
    expect(toActivityEntries([stored], "user-2")[0]!.byYou).toBe(false);
  });

  it("treats an empty actor as the system, not as the viewer", () => {
    // A cron sweep stores no actor. If the viewer's id were also empty, a
    // plain equality check would label the system's work as the owner's.
    const bySystem = { ...stored, userId: "", role: "" };
    const [entry] = toActivityEntries([bySystem], "");
    expect(entry!.byYou).toBe(false);
    expect(entry!.role).toBeNull();
  });

  it("leaves an unreported count absent rather than zero", () => {
    // 0 applied reads as "it did nothing"; absent reads as "it did not say".
    const withoutCounts: CopilotAuditEvent = { ...stored };
    delete withoutCounts.applied;
    delete withoutCounts.skipped;
    const [entry] = toActivityEntries([withoutCounts], "user-1");
    expect(entry).not.toHaveProperty("applied");
    expect(entry).not.toHaveProperty("skipped");
  });

  it("keeps a refusal code when there is one", () => {
    const refused: CopilotAuditEvent = {
      ...stored,
      outcome: "refused",
      reason: "forbidden",
    };
    expect(toActivityEntries([refused], "user-1")[0]).toMatchObject({
      outcome: "refused",
      reason: "forbidden",
    });
  });

  it("maps an empty history to an empty list", () => {
    expect(toActivityEntries([], "user-1")).toEqual([]);
  });
});
