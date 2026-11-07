import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import { beforeEach, describe, expect, it } from "vitest";

import { claimEvent, completeEvent, failEvent, stuckEvents } from "../lib/server/connections";

/**
 * A delivery is not handled the moment it arrives.
 *
 * The old code inserted the event id before storing the message, running the
 * model and sending the reply, then answered 200. Any failure after that was
 * permanent: the retry carried the same id, the insert conflicted, and the
 * customer's message was gone. These tests pin the lifecycle that replaced
 * it, against a stand-in that behaves the way the SQL functions do.
 */

type Row = {
  status: "received" | "processing" | "completed" | "failed" | "retryable";
  attempts: number;
  lockedUntil: number | null;
  lastError: string | null;
  payload: unknown;
};

/**
 * Stands in for the three SQL functions. The behaviour that matters is the
 * conditional update: a row is claimable only when no live lease is held, so
 * two callers racing cannot both be told 'claimed'.
 */
function fakeLedger(now = () => Date.now()) {
  const rows = new Map<string, Row>();

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const key = `${args.p_provider}:${args.p_event_id}`;
    const at = now();
    if (fn === "hc_receive_webhook_event") {
      if (!rows.has(key))
        rows.set(key, {
          status: "received",
          attempts: 0,
          lockedUntil: null,
          lastError: null,
          payload: args.p_payload,
        });
      return { data: null, error: null };
    }
    if (fn === "hc_claim_webhook_event") {
      const lease = (args.p_lease_seconds as number) * 1000;
      const row = rows.get(key);
      if (!row) {
        rows.set(key, {
          status: "processing",
          attempts: 1,
          lockedUntil: at + lease,
          lastError: null,
          payload: null,
        });
        return { data: "claimed", error: null };
      }
      if (row.status === "completed") return { data: "completed", error: null };
      if (row.lockedUntil !== null && row.lockedUntil >= at)
        return { data: "locked", error: null };
      row.status = "processing";
      row.attempts += 1;
      row.lockedUntil = at + lease;
      row.lastError = null;
      return { data: "claimed", error: null };
    }
    if (fn === "hc_complete_webhook_event") {
      const row = rows.get(key);
      if (row) {
        row.status = "completed";
        row.lockedUntil = null;
        row.lastError = null;
        row.payload = null; // the reason to hold a message is gone
      }
      return { data: null, error: null };
    }
    if (fn === "hc_fail_webhook_event") {
      const row = rows.get(key);
      if (row) {
        row.status = args.p_retryable ? "retryable" : "failed";
        row.lockedUntil = null;
        row.lastError = String(args.p_reason).slice(0, 300);
      }
      return { data: null, error: null };
    }
    if (fn === "hc_stuck_webhook_events") {
      const out = [...rows.entries()]
        .filter(
          ([k, r]) =>
            k.startsWith(`${args.p_provider}:`) &&
            ["received", "processing", "retryable"].includes(r.status) &&
            r.payload !== null &&
            (r.lockedUntil === null || r.lockedUntil < at) &&
            r.attempts < 5,
        )
        .map(([k, r]) => ({
          event_id: k.split(":").slice(1).join(":"),
          payload: r.payload,
          attempts: r.attempts,
        }));
      return { data: out, error: null };
    }
    throw new Error(`unexpected rpc ${fn}`);
  };

  // `receive` is exposed separately because the helper that calls it takes
  // the typed client, and the stand-in is deliberately untyped.
  const receive = (eventId: string, payload: unknown) =>
    rpc("hc_receive_webhook_event", {
      p_provider: "meta",
      p_event_id: eventId,
      p_payload: payload,
    });

  return { admin: { rpc } as never, rows, receive };
}

let clock = 1_000_000;
beforeEach(() => {
  clock = 1_000_000;
});

describe("claiming a delivery", () => {
  it("claims an event nobody has seen", async () => {
    const { admin } = fakeLedger(() => clock);
    expect(await claimEvent(admin, "meta", "messenger:m1")).toBe("claimed");
  });

  it("refuses a second worker while the lease is live", async () => {
    // Two instances can receive the same retry at once. Only one may reply.
    const { admin } = fakeLedger(() => clock);
    expect(await claimEvent(admin, "meta", "messenger:m1")).toBe("claimed");
    expect(await claimEvent(admin, "meta", "messenger:m1")).toBe("locked");
  });

  it("refuses work already finished, however many times it is redelivered", async () => {
    const { admin } = fakeLedger(() => clock);
    await claimEvent(admin, "meta", "messenger:m1");
    await completeEvent(admin, "meta", "messenger:m1");
    expect(await claimEvent(admin, "meta", "messenger:m1")).toBe("completed");
    expect(await claimEvent(admin, "meta", "messenger:m1")).toBe("completed");
  });

  it("lets a retry through after a failure, which is the whole point", async () => {
    // The regression: under the old insert-first code this was 'already
    // seen' and the customer never got an answer.
    const { admin } = fakeLedger(() => clock);
    await claimEvent(admin, "meta", "messenger:m1");
    await failEvent(admin, "meta", "messenger:m1", "send failed", true);
    expect(await claimEvent(admin, "meta", "messenger:m1")).toBe("claimed");
  });

  it("recovers an event whose worker died, once the lease expires", async () => {
    const { admin, rows } = fakeLedger(() => clock);
    await claimEvent(admin, "meta", "messenger:m1", 120);
    expect(await claimEvent(admin, "meta", "messenger:m1", 120)).toBe("locked");
    clock += 121_000;
    expect(await claimEvent(admin, "meta", "messenger:m1", 120)).toBe("claimed");
    expect(rows.get("meta:messenger:m1")?.attempts).toBe(2);
  });

  it("counts attempts, so a poisonous event can be given up on", async () => {
    const { admin, rows } = fakeLedger(() => clock);
    for (let i = 0; i < 3; i += 1) {
      await claimEvent(admin, "meta", "messenger:m1");
      await failEvent(admin, "meta", "messenger:m1", "still broken", true);
    }
    expect(rows.get("meta:messenger:m1")?.attempts).toBe(3);
  });
});

describe("what a failure records", () => {
  it("keeps a bounded reason and releases the lease", async () => {
    const { admin, rows } = fakeLedger(() => clock);
    await claimEvent(admin, "meta", "messenger:m1");
    await failEvent(admin, "meta", "messenger:m1", "x".repeat(900), true);
    const row = rows.get("meta:messenger:m1");
    expect(row?.lastError?.length).toBe(300);
    expect(row?.lockedUntil).toBeNull();
    expect(row?.status).toBe("retryable");
  });

  it("can park an event that will never succeed", async () => {
    const { admin, rows } = fakeLedger(() => clock);
    await claimEvent(admin, "meta", "messenger:m1");
    await failEvent(admin, "meta", "messenger:m1", "unreadable stored event", false);
    expect(rows.get("meta:messenger:m1")?.status).toBe("failed");
    // Parked, not retried: it is not offered to the sweeper.
    expect(await stuckEvents(admin, "meta")).toHaveLength(0);
  });
});

describe("what the sweeper picks up", () => {
  it("finds an accepted event that was never finished", async () => {
    // The gap: the route answers 200, so Meta never redelivers, and `after`
    // can be cut off. Without this the event would be lost.
    const { admin, receive } = fakeLedger(() => clock);
    await receive("messenger:m1", { type: "message", text: "hello" });
    const stuck = await stuckEvents(admin, "meta");
    expect(stuck).toHaveLength(1);
    expect(stuck[0].eventId).toBe("messenger:m1");
  });

  it("does not offer an event another worker is actively processing", async () => {
    const { admin, receive } = fakeLedger(() => clock);
    await receive("messenger:m1", { type: "message" });
    await claimEvent(admin, "meta", "messenger:m1", 120);
    expect(await stuckEvents(admin, "meta")).toHaveLength(0);
    clock += 121_000;
    expect(await stuckEvents(admin, "meta")).toHaveLength(1);
  });

  it("stops holding the customer's message once the work succeeds", async () => {
    const { admin, rows, receive } = fakeLedger(() => clock);
    await receive("messenger:m1", { type: "message", text: "my phone number is private" });
    await claimEvent(admin, "meta", "messenger:m1");
    await completeEvent(admin, "meta", "messenger:m1");
    expect(rows.get("meta:messenger:m1")?.payload).toBeNull();
    expect(await stuckEvents(admin, "meta")).toHaveLength(0);
  });
});
