import { describe, expect, it } from "vitest";

import {
  assistantIdentitySchema,
  parseAssistantIdentity,
  sampleAssistantIdentity,
} from "../lib/assistant";

describe("assistant identity", () => {
  it("accepts the bounded sample identity", () => {
    expect(assistantIdentitySchema.parse(sampleAssistantIdentity)).toEqual(
      sampleAssistantIdentity,
    );
  });

  it("rejects missing identity fields and unknown properties", () => {
    expect(parseAssistantIdentity({ name: "Guide" }).success).toBe(false);
    expect(
      parseAssistantIdentity({ ...sampleAssistantIdentity, secret: "no" })
        .success,
    ).toBe(false);
  });
});
