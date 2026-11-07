// Fixed-window limiters for public endpoints.
//
// Two of them. `rateLimit` lives in one instance's memory, so on serverless
// the real ceiling is roughly instances x limit; it survives as a cheap gate
// before a request is worth a database round trip, and as the only limit on
// the practice routes, which cost nothing. `sharedRateLimit` counts in
// Postgres and is the one that actually holds on the live endpoints.
//
// Neither is a spending control. The usage ledger reserves against a durable
// per-workspace cap before any paid call and fails closed; these fail open.
import type { SupabaseClient } from "@supabase/supabase-js";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 5000;

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function clientKey(request: Request, scope: string) {
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "local";
  return `${scope}:${ip}`;
}

/**
 * A bucket keyed by both the visitor and the widget installation.
 *
 * One noisy visitor should not exhaust a business's whole allowance, and one
 * installation being hammered from many addresses should still be bounded.
 * Both parts are present so either can be limited; the caller picks the
 * limit that goes with the scope.
 */
export function visitorBucket(request: Request, scope: string, installationId: string) {
  return `${clientKey(request, scope)}:${installationId.slice(0, 80)}`;
}

/** Everything hitting one installation, regardless of who is sending it. */
export function installationBucket(scope: string, installationId: string) {
  return `${scope}:install:${installationId.slice(0, 80)}`;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitResult {
  if (buckets.size > MAX_KEYS) {
    for (const [k, bucket] of buckets)
      if (bucket.resetAt <= now) buckets.delete(k);
    if (buckets.size > MAX_KEYS) buckets.clear();
  }
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  const ok = bucket.count <= limit;
  return {
    ok,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSeconds: ok ? 0 : Math.ceil((bucket.resetAt - now) / 1000),
  };
}

export function tooManyRequests(result: RateLimitResult) {
  return Response.json(
    { error: "Too many requests. Wait a moment and try again." },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSeconds),
        "Cache-Control": "no-store",
      },
    },
  );
}

export function resetRateLimits() {
  buckets.clear();
}

/**
 * The same fixed window, counted somewhere every instance can see.
 *
 * The in-memory version above is per process, so on serverless the real
 * ceiling is roughly instances x limit. This counts in Postgres instead,
 * which is already here and already authoritative for spending.
 *
 * **Fails open.** If the counter is unreachable the request proceeds. The
 * alternative is that a database blip takes every business's website chat
 * offline, and the limiter is not what protects the budget — the usage
 * ledger reserves against a durable per-workspace cap before any paid call,
 * and it fails closed. This limiter exists to blunt abuse, not to bound
 * spend, and the two should not be confused.
 */
export async function sharedRateLimit(
  admin: SupabaseClient,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  try {
    const { data, error } = await admin.rpc("hc_rate_limit_hit", {
      p_bucket: bucket,
      p_window_seconds: windowSeconds,
    });
    if (error) throw new Error("rate limit unavailable");
    const row = (Array.isArray(data) ? data[0] : data) as
      | { hits?: number; reset_in_seconds?: number }
      | null;
    const hits = row?.hits ?? 0;
    const resetIn = row?.reset_in_seconds ?? windowSeconds;
    const ok = hits <= limit;
    return {
      ok,
      remaining: Math.max(0, limit - hits),
      retryAfterSeconds: ok ? 0 : Math.max(1, resetIn),
    };
  } catch (error) {
    console.error(
      "[rate-limit] shared counter unavailable, allowing:",
      error instanceof Error ? error.message : "unknown",
    );
    return { ok: true, remaining: limit, retryAfterSeconds: 0 };
  }
}
