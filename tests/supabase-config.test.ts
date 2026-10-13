import { afterEach, describe, expect, it } from "vitest";

import {
  getSupabasePublicConfig,
  safeNextPath,
} from "../lib/supabase/config";

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

afterEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalKey;
});

describe("Supabase project configuration", () => {
  it("accepts only the authorized HelloCrew project", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL =
      "https://yfmoggubjsffgameexfi.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";

    expect(getSupabasePublicConfig()).toEqual({
      url: "https://yfmoggubjsffgameexfi.supabase.co",
      publishableKey: "test-publishable-key",
    });
  });

  it("fails closed when a different project is configured", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL =
      "https://another-project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";

    expect(() => getSupabasePublicConfig()).toThrow(
      "expects Supabase project yfmoggubjsffgameexfi",
    );
  });
});

describe("OAuth return paths", () => {
  it.each([
    [null, "/workspace"],
    ["https://attacker.example", "/workspace"],
    ["//attacker.example/path", "/workspace"],
    ["/workspace?tab=settings", "/workspace?tab=settings"],
    ["/app#practice", "/app#practice"],
  ])("normalizes %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});
