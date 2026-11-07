import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import { beforeEach, describe, expect, it } from "vitest";

import { claimTurn, releaseTurn, turnStillValid } from "../lib/server/conversation-lock";

/**
 * One automated turn per conversation.
 *
 * Without the lease, two messages arriving together produced two model turns
 * that each read the history without the other's reply, then both answered:
 * two replies to one customer, possibly contradicting each other, both
 * billed. Human takeover had the same shape, because mode was read once
 * before the turn started.
 */

const TENANT = "11111111-1111-1111-1111-111111111111";
const CONVO = "22222222-2222-2222-2222-222222222222";

type Row = { mode: "ai" | "human"; lockedUntil: number | null; owner: string | null };

/** Stands in for the SQL: one conditional update, so only one caller wins. */
function fakeLocks(now: () => number, initial: Partial<Row> = {}) {
  const row: Row = { mode: "ai", lockedUntil: null, owner: null, ...initial };
  let issued = 0;

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    if (args.p_tenant_id !== TENANT || args.p_conversation_id !== CONVO)
      return { data: fn === "hc_turn_still_valid" ? false : null, error: null };
    const at = now();
    if (fn === "hc_claim_conversation_turn") {
      const free = row.lockedUntil === null || row.lockedUntil < at;
      if (row.mode !== "ai" || !free) return { data: null, error: null };
      issued += 1;
      row.owner = `owner-${issued}`;
      row.lockedUntil = at + (args.p_lease_seconds as number) * 1000;
      return { data: row.owner, error: null };
    }
    if (fn === "hc_release_conversation_turn") {
      if (row.owner === args.p_owner) {
        row.owner = null;
        row.lockedUntil = null;
      }
      return { data: null, error: null };
    }
    if (fn === "hc_turn_still_valid")
      return { data: row.owner === args.p_owner && row.mode === "ai", error: null };
    throw new Error(`unexpected rpc ${fn}`);
  };

  return { admin: { rpc } as never, row };
}

let clock = 5_000_000;
beforeEach(() => {
  clock = 5_000_000;
});

describe("taking the turn", () => {
  it("lets one worker in", async () => {
    const { admin } = fakeLocks(() => clock);
    expect(await claimTurn(admin, TENANT, CONVO)).toBeTruthy();
  });

  it("refuses the second of two messages arriving together", async () => {
    // The regression: both used to run, and the customer got two replies.
    const { admin } = fakeLocks(() => clock);
    const first = await claimTurn(admin, TENANT, CONVO);
    const second = await claimTurn(admin, TENANT, CONVO);
    expect(first).toBeTruthy();
    expect(second).toBeNull();
  });

  it("refuses every one of a burst except the first", async () => {
    const { admin } = fakeLocks(() => clock);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => claimTurn(admin, TENANT, CONVO)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("frees the conversation when the turn finishes", async () => {
    const { admin } = fakeLocks(() => clock);
    const owner = await claimTurn(admin, TENANT, CONVO);
    await releaseTurn(admin, TENANT, CONVO, owner!);
    expect(await claimTurn(admin, TENANT, CONVO)).toBeTruthy();
  });

  it("recovers a conversation whose worker died", async () => {
    // Otherwise one crash makes a conversation permanently unanswerable.
    const { admin } = fakeLocks(() => clock);
    expect(await claimTurn(admin, TENANT, CONVO, 90)).toBeTruthy();
    expect(await claimTurn(admin, TENANT, CONVO, 90)).toBeNull();
    clock += 91_000;
    expect(await claimTurn(admin, TENANT, CONVO, 90)).toBeTruthy();
  });

  it("never answers a conversation a person has taken over", async () => {
    const { admin } = fakeLocks(() => clock, { mode: "human" });
    expect(await claimTurn(admin, TENANT, CONVO)).toBeNull();
  });

  it("fails closed when the lock cannot be reached", async () => {
    // A duplicate reply to a real customer is worse than a late one.
    const admin = {
      rpc: async () => ({ data: null, error: { message: "unreachable" } }),
    } as never;
    expect(await claimTurn(admin, TENANT, CONVO)).toBeNull();
  });
});

describe("whether the turn may still speak", () => {
  it("holds while the worker owns it", async () => {
    const { admin } = fakeLocks(() => clock);
    const owner = await claimTurn(admin, TENANT, CONVO);
    expect(await turnStillValid(admin, TENANT, CONVO, owner!)).toBe(true);
  });

  it("stops a reply a person stepped in to prevent", async () => {
    // The model takes seconds. A takeover inside that window must win.
    const { admin, row } = fakeLocks(() => clock);
    const owner = await claimTurn(admin, TENANT, CONVO);
    row.mode = "human";
    expect(await turnStillValid(admin, TENANT, CONVO, owner!)).toBe(false);
  });

  it("stops a worker whose lease expired and was taken by another", async () => {
    const { admin } = fakeLocks(() => clock);
    const slow = await claimTurn(admin, TENANT, CONVO, 90);
    clock += 91_000;
    const next = await claimTurn(admin, TENANT, CONVO, 90);
    expect(next).toBeTruthy();
    expect(await turnStillValid(admin, TENANT, CONVO, slow!)).toBe(false);
    expect(await turnStillValid(admin, TENANT, CONVO, next!)).toBe(true);
  });

  it("does not let a late worker release the new holder's lease", async () => {
    const { admin } = fakeLocks(() => clock);
    const slow = await claimTurn(admin, TENANT, CONVO, 90);
    clock += 91_000;
    const next = await claimTurn(admin, TENANT, CONVO, 90);
    await releaseTurn(admin, TENANT, CONVO, slow!); // the late worker finishing
    expect(await turnStillValid(admin, TENANT, CONVO, next!)).toBe(true);
  });

  it("fails closed when ownership cannot be confirmed", async () => {
    const admin = {
      rpc: async () => ({ data: null, error: { message: "unreachable" } }),
    } as never;
    expect(await turnStillValid(admin, TENANT, CONVO, "owner-1")).toBe(false);
  });
});
