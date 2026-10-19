import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Credentials for connected accounts (page tokens, refresh tokens) are
// encrypted with AES-256-GCM before they reach the database. The key lives
// only in the server environment (HELLOCREW_ENCRYPTION_KEY, 32 bytes as
// base64 or hex), so a database leak alone exposes no tokens.

export class SecretsNotConfiguredError extends Error {
  constructor() {
    super("HELLOCREW_ENCRYPTION_KEY is not set.");
  }
}

function key(env: Record<string, string | undefined> = process.env): Buffer {
  const raw = env.HELLOCREW_ENCRYPTION_KEY?.trim();
  if (!raw) throw new SecretsNotConfiguredError();
  const bytes = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (bytes.length !== 32) throw new SecretsNotConfiguredError();
  return bytes;
}

export function secretsConfigured(env: Record<string, string | undefined> = process.env) {
  try {
    key(env);
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(value: unknown, env?: Record<string, string | undefined>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(env), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
}

export function decryptSecret<T>(stored: string, env?: Record<string, string | undefined>): T {
  if (!stored.startsWith("v1:")) throw new Error("Unknown secret format.");
  const raw = Buffer.from(stored.slice(3), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(env), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  const text = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  return JSON.parse(text) as T;
}
