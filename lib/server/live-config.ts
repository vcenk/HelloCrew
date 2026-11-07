import "server-only";

// Server-only configuration for live AI. Nothing here is exposed to the browser.
export type LiveConfig = {
  openaiApiKey: string;
  /** Chosen per task by lib/server/model-router.ts, never by a feature. */
  models: { fast: string; strong: string };
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  maxOutputTokens: number;
  platformMonthlyCapMicroUsd: bigint;
  supabaseSecretKey: string;
};

export type LiveReadiness =
  | { ready: true; config: LiveConfig }
  | { ready: false; missing: ("openai_key" | "supabase_secret")[] };

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readLiveConfig(
  env: Record<string, string | undefined> = process.env,
): LiveReadiness {
  const missing: ("openai_key" | "supabase_secret")[] = [];
  const openaiApiKey = env.OPENAI_API_KEY?.trim() ?? "";
  const supabaseSecretKey = env.SUPABASE_SECRET_KEY?.trim() ?? "";
  if (!openaiApiKey) missing.push("openai_key");
  if (!supabaseSecretKey) missing.push("supabase_secret");
  if (missing.length > 0) return { ready: false, missing };
  return {
    ready: true,
    config: {
      openaiApiKey,
      supabaseSecretKey,
      models: {
        // OPENAI_MODEL stays the single-model default so existing
        // deployments keep working without new variables.
        fast:
          env.OPENAI_MODEL_FAST?.trim() ||
          env.OPENAI_MODEL?.trim() ||
          "gpt-6-luna",
        strong:
          env.OPENAI_MODEL_STRONG?.trim() ||
          env.OPENAI_MODEL?.trim() ||
          "gpt-6-luna",
      },
      // Deliberately above the default model's published rates. Luna is
      // $0.10/$0.50 per Mtok, so a deployment that sets no price variables
      // over-reserves by half on input. That is the safe direction: an
      // under-estimate lets a tenant spend past its cap before anyone
      // notices, while an over-estimate only reserves too much and releases
      // the remainder at settlement.
      inputUsdPerMTok: positiveNumber(env.OPENAI_INPUT_USD_PER_MTOK, 0.15),
      outputUsdPerMTok: positiveNumber(env.OPENAI_OUTPUT_USD_PER_MTOK, 0.6),
      maxOutputTokens: Math.min(
        4000,
        positiveNumber(env.OPENAI_MAX_OUTPUT_TOKENS, 1200),
      ),
      platformMonthlyCapMicroUsd: BigInt(
        Math.round(
          positiveNumber(env.HELLOCREW_PLATFORM_MONTHLY_CAP_USD, 20) * 1e6,
        ),
      ),
    },
  };
}
