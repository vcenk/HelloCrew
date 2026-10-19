import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret, SecretsNotConfiguredError, secretsConfigured } from "../lib/server/secrets";

const env = { HELLOCREW_ENCRYPTION_KEY: randomBytes(32).toString("base64") };

describe("encrypted connection credentials", () => {
  it("round-trips and never stores the plain token", () => {
    const stored = encryptSecret({ pageToken: "EAAB-secret" }, env);
    expect(stored).toMatch(/^v1:/);
    expect(stored).not.toContain("EAAB");
    expect(decryptSecret<{ pageToken: string }>(stored, env).pageToken).toBe("EAAB-secret");
  });

  it("uses a fresh nonce each time", () => {
    expect(encryptSecret("x", env)).not.toBe(encryptSecret("x", env));
  });

  it("rejects tampering and the wrong key", () => {
    const stored = encryptSecret({ a: 1 }, env);
    const tampered = stored.slice(0, -4) + (stored.endsWith("AAAA") ? "BBBB" : "AAAA");
    expect(() => decryptSecret(tampered, env)).toThrow();
    expect(() => decryptSecret(stored, { HELLOCREW_ENCRYPTION_KEY: randomBytes(32).toString("hex") })).toThrow();
  });

  it("refuses to run without a proper key", () => {
    expect(secretsConfigured({})).toBe(false);
    expect(secretsConfigured({ HELLOCREW_ENCRYPTION_KEY: "short" })).toBe(false);
    expect(() => encryptSecret("x", {})).toThrow(SecretsNotConfiguredError);
  });
});
