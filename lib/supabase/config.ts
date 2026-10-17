const EXPECTED_PROJECT_REF = "yfmoggubjsffgameexfi";

export function isSupabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

export function getSupabasePublicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  const parsed = new URL(url);
  if (parsed.hostname !== `${EXPECTED_PROJECT_REF}.supabase.co`) {
    throw new Error(
      `HelloCrew expects Supabase project ${EXPECTED_PROJECT_REF}; received ${parsed.hostname}.`,
    );
  }

  return { url: parsed.origin, publishableKey };
}

export function getSiteUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return new URL(configured).origin;

  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelHost) return new URL(`https://${vercelHost}`).origin;

  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";

  throw new Error("NEXT_PUBLIC_SITE_URL is required for production OAuth.");
}

export function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/workspace";
  }

  try {
    const parsed = new URL(value, "https://hellocrew.invalid");
    if (parsed.origin !== "https://hellocrew.invalid") return "/workspace";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/workspace";
  }
}
