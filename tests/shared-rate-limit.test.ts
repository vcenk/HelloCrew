import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import { beforeEach, describe, expect, it } from "vitest";

import {
  installationBucket,
  sharedRateLimit,
  tooManyRequests,
  visitorBucket,
} from "../lib/server/rate-limit";

/**
 * A limit that means something across instances.
 *
 * The in-memory limiter counts per process, so on serverless the real
 * ceiling is roughly instances x limit — it rises exactly when traffic does.
 * These pin the shared counter, and in particular that it fails open:
 * the usage ledger is what protects spending, and a database blip must not
 * take every business's website chat offline.
 */

/** Stands in for hc_rate_limit_hit: one statement, shared by every caller. */
function fakeCounter(now: () => number) {
  const rows = new Map<string, { startedAt: number; hits: number }>();
  const rpc = async (_fn: string, args: Record<string, unknown>) => {
    const at = now();
    const windowMs = (args.p_window_seconds as number) * 1000;
    const key = String(args.p_bucket);
    const row = rows.get(key);
    if (!row || row.startedAt + windowMs <= at) {
      rows.set(key, { startedAt: at, hits: 1 });
      return { data: [{ hits: 1, reset_in_seconds: args.p_window_seconds }], error: null };
    }
    row.hits += 1;
    return {
      data: [
        {
          hits: row.hits,
          reset_in_seconds: Math.ceil((row.startedAt + windowMs - at) / 1000),
        },
      ],
      error: null,
    };
  };
  return { admin: { rpc } as never, rows };
}

const req = (ip = "203.0.113.5") =>
  new Request("https://agentland.app/api/widget/chat", {
    headers: { "x-forwarded-for": ip },
  });

let clock = 2_000_000;
beforeEach(() => {
  clock = 2_000_000;
});

describe("the shared counter", () => {
  it("allows up to the limit and refuses past it", async () => {
    const { admin } = fakeCounter(() => clock);
    for (let i = 0; i < 3; i += 1)
      expect((await sharedRateLimit(admin, "b", 3, 60)).ok).toBe(true);
    expect((await sharedRateLimit(admin, "b", 3, 60)).ok).toBe(false);
  });

  it("counts every instance into the same bucket", async () => {
    // The whole point. Two callers here stand for two serverless instances;
    // with the in-memory limiter each would have had its own allowance.
    const { admin } = fakeCounter(() => clock);
    await sharedRateLimit(admin, "shared", 2, 60);
    await sharedRateLimit(admin, "shared", 2, 60);
    expect((await sharedRateLimit(admin, "shared", 2, 60)).ok).toBe(false);
  });

  it("starts a fresh window once the old one passes", async () => {
    const { admin } = fakeCounter(() => clock);
    await sharedRateLimit(admin, "b", 1, 60);
    expect((await sharedRateLimit(admin, "b", 1, 60)).ok).toBe(false);
    clock += 61_000;
    expect((await sharedRateLimit(admin, "b", 1, 60)).ok).toBe(true);
  });

  it("reports a usable Retry-After", async () => {
    const { admin } = fakeCounter(() => clock);
    await sharedRateLimit(admin, "b", 1, 60);
    const blocked = await sharedRateLimit(admin, "b", 1, 60);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
    const response = tooManyRequests(blocked);
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBe(blocked.retryAfterSeconds);
  });

  it("lets traffic through when the counter is unreachable", async () => {
    // Deliberate. Spending is bounded by the usage ledger, which fails
    // closed; this is abuse control, and a database blip taking every
    // customer's chat offline is the worse failure.
    const admin = {
      rpc: async () => ({ data: null, error: { message: "unreachable" } }),
    } as never;
    const result = await sharedRateLimit(admin, "b", 1, 60);
    expect(result.ok).toBe(true);
  });

  it("lets traffic through when the counter throws", async () => {
    const admin = {
      rpc: async () => {
        throw new Error("connection reset");
      },
    } as never;
    expect((await sharedRateLimit(admin, "b", 1, 60)).ok).toBe(true);
  });
});

describe("what gets counted separately", () => {
  it("gives two visitors on one site their own allowance", async () => {
    const { admin } = fakeCounter(() => clock);
    const a = visitorBucket(req("203.0.113.5"), "widget-chat", "inst-1");
    const b = visitorBucket(req("198.51.100.9"), "widget-chat", "inst-1");
    expect(a).not.toBe(b);
    await sharedRateLimit(admin, a, 1, 60);
    expect((await sharedRateLimit(admin, a, 1, 60)).ok).toBe(false);
    expect((await sharedRateLimit(admin, b, 1, 60)).ok).toBe(true);
  });

  it("keeps one visitor's two sites apart", async () => {
    const one = visitorBucket(req(), "widget-chat", "inst-1");
    const two = visitorBucket(req(), "widget-chat", "inst-2");
    expect(one).not.toBe(two);
  });

  it("bounds a whole installation across many addresses", async () => {
    // One visitor limit cannot catch a flood from many addresses.
    const { admin } = fakeCounter(() => clock);
    const site = installationBucket("widget-chat", "inst-1");
    await sharedRateLimit(admin, site, 2, 60);
    await sharedRateLimit(admin, site, 2, 60);
    expect((await sharedRateLimit(admin, site, 2, 60)).ok).toBe(false);
  });

  it("bounds the key, so a long installation id cannot grow the row", async () => {
    expect(visitorBucket(req(), "widget-chat", "x".repeat(500)).length).toBeLessThan(200);
    expect(installationBucket("widget-chat", "x".repeat(500)).length).toBeLessThan(200);
  });
});
