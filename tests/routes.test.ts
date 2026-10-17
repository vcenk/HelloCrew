import { describe, expect, it } from "vitest";
import { isSameOrigin, POST } from "../app/api/demo/route";
import { POST as LIVE } from "../app/api/live/route";
describe("server safety boundaries", () => {
  it("fails live mode closed", async () => {
    expect((await LIVE()).status).toBe(503);
  });
  it("rejects non JSON", async () => {
    expect(
      (
        await POST(
          new Request("http://localhost/api/demo", {
            method: "POST",
            body: "hello",
          }),
        )
      ).status,
    ).toBe(415);
  });
  it("rejects cross origin requests", async () => {
    expect(
      (
        await POST(
          new Request("http://localhost/api/demo", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: "https://other.example",
            },
            body: "{}",
          }),
        )
      ).status,
    ).toBe(403);
  });
  it("accepts the browser origin when Next listens on a different host", () => {
    expect(
      isSameOrigin(
        new Request("http://0.0.0.0:3000/api/demo", {
          headers: {
            Host: "localhost:3000",
            Origin: "http://localhost:3000",
          },
        }),
      ),
    ).toBe(true);
  });
  it("rejects a forwarded protocol mismatch", () => {
    expect(
      isSameOrigin(
        new Request("http://0.0.0.0:3000/api/demo", {
          headers: {
            Host: "app.example",
            Origin: "http://app.example",
            "X-Forwarded-Proto": "https",
          },
        }),
      ),
    ).toBe(false);
  });
  it("enforces actual byte cap without content length", async () => {
    expect(
      (
        await POST(
          new Request("http://localhost/api/demo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "x".repeat(33000),
          }),
        )
      ).status,
    ).toBe(413);
  });
  it("handles invalid JSON without leaking errors", async () => {
    const r = await POST(
      new Request("http://localhost/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
    );
    expect(r.status).toBe(400);
  });
});

describe("public endpoint rate limiting", () => {
  it("returns 429 after the per-client window is exhausted", async () => {
    const { rateLimit, resetRateLimits } =
      await import("../lib/server/rate-limit");
    resetRateLimits();
    const results = Array.from({ length: 4 }, () =>
      rateLimit("test:1.2.3.4", 3, 60_000, 1000),
    );
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false]);
    expect(results[3].retryAfterSeconds).toBe(60);
    expect(rateLimit("test:1.2.3.4", 3, 60_000, 62_000).ok).toBe(true);
  });
});
