import { describe, expect, it } from "vitest";

import {
  assistantPurposePresets,
  assistantIdentitySchema,
  identityForPurpose,
  parseAssistantIdentity,
  parseStoredAssistantIdentity,
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

  it("provides a complete editable starter for every purpose", () => {
    expect(assistantPurposePresets).toHaveLength(5);
    for (const preset of assistantPurposePresets) {
      expect(
        assistantIdentitySchema.parse(identityForPurpose(preset.purpose)),
      ).toEqual(
        expect.objectContaining({
          purpose: preset.purpose,
          name: preset.name,
          role: preset.role,
        }),
      );
      expect(preset.features).toHaveLength(3);
    }
  });

  it("migrates a saved identity without a purpose to receptionist", () => {
    const legacyIdentity: Record<string, unknown> = {
      ...sampleAssistantIdentity,
    };
    delete legacyIdentity.purpose;
    const parsed = parseAssistantIdentity(legacyIdentity);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.purpose).toBe("receptionist");
  });

  it("fails safely when browser storage is empty or invalid", () => {
    expect(parseStoredAssistantIdentity(null)).toEqual(sampleAssistantIdentity);
    expect(parseStoredAssistantIdentity("not-json")).toEqual(
      sampleAssistantIdentity,
    );
  });
});
