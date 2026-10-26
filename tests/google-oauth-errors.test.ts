import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { calendarConnectError } from "../lib/calendar/connect-errors";
import { exchangeGoogleCode, GoogleApiError } from "../lib/server/google";

const reply = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );

beforeEach(() => {
  // exchangeGoogleCode refuses before it ever calls Google without these.
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "test-client-id");
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "test-client-secret");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("what Google's refusal tells the owner", () => {
  it("keeps the error code, not just the description", async () => {
    // Google puts "Bad Request" in error_description and the real diagnosis
    // in error. Reading the description alone left the owner with nothing.
    vi.stubGlobal(
      "fetch",
      reply(400, {
        error: "redirect_uri_mismatch",
        error_description: "Bad Request",
      }),
    );
    await expect(
      exchangeGoogleCode("code", "http://localhost:3000/cb"),
    ).rejects.toThrow(/redirect_uri_mismatch/);
  });

  it("names an unrecognised OAuth client", async () => {
    vi.stubGlobal(
      "fetch",
      reply(401, { error: "invalid_client", error_description: "Unauthorized" }),
    );
    await expect(
      exchangeGoogleCode("code", "http://localhost:3000/cb"),
    ).rejects.toThrow(/invalid_client/);
  });

  it("names a code that was already used", async () => {
    vi.stubGlobal(
      "fetch",
      reply(400, { error: "invalid_grant", error_description: "Bad Request" }),
    );
    await expect(
      exchangeGoogleCode("code", "http://localhost:3000/cb"),
    ).rejects.toThrow(/invalid_grant/);
  });

  it("still says something when Google sends no detail at all", async () => {
    vi.stubGlobal("fetch", reply(500, {}));
    await expect(
      exchangeGoogleCode("code", "http://localhost:3000/cb"),
    ).rejects.toThrow(/Google sign-in failed/);
  });

  it("carries Google's status code for the log", async () => {
    vi.stubGlobal("fetch", reply(400, { error: "redirect_uri_mismatch" }));
    const error = await exchangeGoogleCode(
      "code",
      "http://localhost:3000/cb",
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GoogleApiError);
    expect((error as GoogleApiError).status).toBe(400);
  });
});

/**
 * The callback turns the thrown message into one of its codes. These pin the
 * pairing: a regex that stops matching Google's real wording would silently
 * drop the owner back to "Google didn't accept the sign-in".
 */
describe("the message the callback has to recognise", () => {
  it.each([
    ["redirect_uri_mismatch: Bad Request", "gcal_redirect_uri"],
    ["invalid_client: Unauthorized", "gcal_bad_client"],
    ["invalid_grant: Bad Request", "gcal_invalid_grant"],
    [
      "Google Calendar API has not been used in project 123 before or it is disabled.",
      "gcal_api_disabled",
    ],
    ["Request had insufficient authentication scopes.", "gcal_scope"],
    ["Something nobody has seen before", "google_login"],
  ])("%s becomes %s", (message, code) => {
    expect(calendarConnectError(message)).toBe(code);
  });
});
