import { describe, expect, it } from "vitest";
import { POST } from "../app/api/demo/route";
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
