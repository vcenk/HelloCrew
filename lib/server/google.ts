import "server-only";

import type { Connection } from "./connections";

// Google Business Profile: reviews for connected locations. The API needs
// Google's approval for the Cloud project; until then calls return 403/429.

export type GoogleCredentials = { refreshToken?: string };

const SCOPE = "https://www.googleapis.com/auth/business.manage";

export function readGoogleConfig(env: Record<string, string | undefined> = process.env) {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function googleConfigured() {
  return Boolean(readGoogleConfig());
}

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function googleLoginUrl(
  clientId: string,
  redirectUri: string,
  state: string,
  // Calendar and Business Profile are connected separately: a salon may want
  // one without the other, and Business Profile access is review-gated.
  scope: string = SCOPE,
) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scope);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

async function tokenRequest(body: Record<string, string>) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    error_description?: string;
  };
  if (!response.ok || !data.access_token) throw new GoogleApiError(data.error_description ?? "Google sign-in failed.", response.status);
  return data;
}

export async function exchangeGoogleCode(code: string, redirectUri: string) {
  const config = readGoogleConfig();
  if (!config) throw new GoogleApiError("Google isn’t set up on the server.");
  return tokenRequest({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
}

export async function googleAccessToken(credentials: GoogleCredentials | null) {
  return accessToken(credentials);
}

async function accessToken(credentials: GoogleCredentials | null) {
  const config = readGoogleConfig();
  if (!config) throw new GoogleApiError("Google isn’t set up on the server.");
  if (!credentials?.refreshToken) throw new GoogleApiError("Reconnect Google: the sign-in has expired.");
  const data = await tokenRequest({
    refresh_token: credentials.refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
  });
  return data.access_token!;
}

async function call<T>(token: string, url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(url, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok)
    throw new GoogleApiError(
      response.status === 403 || response.status === 429
        ? "Google hasn’t approved Business Profile API access for HelloCrew yet."
        : (data.error?.message ?? `Google request failed (${response.status}).`),
      response.status,
    );
  return data;
}

export type GoogleLocation = { name: string; title: string };

// All locations the signed-in Google user manages, as
// "accounts/{account}/locations/{location}" names (what the reviews API uses).
export async function listGoogleLocations(accessTokenValue: string): Promise<GoogleLocation[]> {
  const accounts = await call<{ accounts?: { name: string }[] }>(
    accessTokenValue,
    "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
  );
  const out: GoogleLocation[] = [];
  for (const account of (accounts.accounts ?? []).slice(0, 5)) {
    const locations = await call<{ locations?: { name: string; title?: string }[] }>(
      accessTokenValue,
      `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title&pageSize=100`,
    );
    for (const location of locations.locations ?? [])
      out.push({ name: `${account.name}/${location.name}`, title: location.title ?? "Google location" });
  }
  return out;
}

const stars: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export type GoogleReview = {
  name: string;
  authorName: string | null;
  rating: number | null;
  comment: string;
  createdAt: string;
  answered: boolean;
};

export function parseGoogleReviews(payload: unknown): GoogleReview[] {
  const reviews = (payload as { reviews?: unknown[] })?.reviews ?? [];
  return reviews.flatMap((raw) => {
    const r = raw as {
      name?: string;
      reviewer?: { displayName?: string; isAnonymous?: boolean };
      starRating?: string;
      comment?: string;
      createTime?: string;
      reviewReply?: { comment?: string };
    };
    if (!r.name) return [];
    return [
      {
        name: r.name,
        authorName: r.reviewer?.isAnonymous ? null : (r.reviewer?.displayName ?? null),
        rating: r.starRating ? (stars[r.starRating] ?? null) : null,
        // Google appends a machine translation after this marker.
        comment: (r.comment ?? "").split("\n\n(Translated by Google)")[0].trim(),
        createdAt: r.createTime ?? new Date().toISOString(),
        answered: Boolean(r.reviewReply?.comment),
      },
    ];
  });
}

export async function fetchRecentReviews(connection: Connection<GoogleCredentials>) {
  const token = await accessToken(connection.credentials);
  const data = await call<unknown>(
    token,
    `https://mybusiness.googleapis.com/v4/${connection.externalId}/reviews?pageSize=50&orderBy=updateTime%20desc`,
  );
  return parseGoogleReviews(data);
}

export async function postGoogleReply(connection: Connection<GoogleCredentials>, reviewName: string, text: string) {
  if (!reviewName.startsWith(`${connection.externalId}/reviews/`)) throw new GoogleApiError("That review isn’t from this location.");
  const token = await accessToken(connection.credentials);
  await call(token, `https://mybusiness.googleapis.com/v4/${reviewName}/reply`, {
    method: "PUT",
    body: { comment: text.slice(0, 4000) },
  });
}
