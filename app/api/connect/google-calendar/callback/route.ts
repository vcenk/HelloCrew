import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { DEFAULT_CALENDAR_SETTINGS } from "@/lib/calendar/account";
import { getWorkspaceContext } from "@/lib/data/workspace";
import { ConnectionTakenError, saveConnection } from "@/lib/server/connections";
import { exchangeGoogleCode, GoogleApiError } from "@/lib/server/google";
import { widgetAdminClient } from "@/lib/server/widget-installations";
import { getSiteUrl } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

function done(request: NextRequest, query: string) {
  const response = NextResponse.redirect(
    new URL(`/app/connections?${query}`, request.url),
  );
  response.cookies.delete({
    name: "hc_gcal_state",
    path: "/api/connect/google-calendar",
  });
  return response;
}

type CalendarListEntry = {
  id: string;
  summary?: string;
  primary?: boolean;
  accessRole?: string;
  timeZone?: string;
};

/** The calendar to connect: the primary one, which is what a business runs on. */
async function primaryCalendar(
  accessToken: string,
): Promise<CalendarListEntry | null> {
  const response = await fetch(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=50&minAccessRole=writer",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok)
    throw new GoogleApiError("Could not list calendars.", response.status);
  const data = (await response.json()) as { items?: CalendarListEntry[] };
  const items = data.items ?? [];
  return items.find((item) => item.primary) ?? items[0] ?? null;
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  if (url.searchParams.get("error"))
    return done(request, "error=google_cancelled");

  const expected = request.cookies.get("hc_gcal_state")?.value;
  const given = url.searchParams.get("state");
  if (
    !expected ||
    !given ||
    expected.length !== given.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(given))
  )
    return done(request, "error=google_state");

  const admin = widgetAdminClient();
  const workspace = await getWorkspaceContext(await createClient());
  if (!admin) return done(request, "error=google_not_configured");
  if (!workspace || workspace.role === "viewer")
    return done(request, "error=forbidden");

  let tokens;
  let calendar: CalendarListEntry | null;
  try {
    tokens = await exchangeGoogleCode(
      url.searchParams.get("code") ?? "",
      `${getSiteUrl()}/api/connect/google-calendar/callback`,
    );
    // Without a refresh token the connection dies in an hour, so refuse it
    // now rather than fail during a customer's conversation.
    if (!tokens.refresh_token) return done(request, "error=google_no_refresh");
    calendar = await primaryCalendar(tokens.access_token!);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error("[google-calendar] connect failed:", message);
    // The two first-run mistakes are worth naming: a redirect URI that is not
    // registered, and the Calendar API not being enabled on the project.
    if (/redirect_uri/i.test(message))
      return done(request, "error=gcal_redirect_uri");
    if (/has not been used|is disabled|accessNotConfigured/i.test(message))
      return done(request, "error=gcal_api_disabled");
    return done(request, "error=google_login");
  }

  if (!calendar) return done(request, "error=gcal_no_calendar");

  try {
    await saveConnection(admin, {
      tenantId: workspace.tenantId,
      provider: "google",
      kind: "google_calendar",
      externalId: calendar.id,
      displayName: calendar.summary ?? calendar.id,
      credentials: { refreshToken: tokens.refresh_token },
      // Google knows the calendar's timezone; the rest is a starting point the
      // owner confirms before the crew offers anything.
      settings: {
        ...DEFAULT_CALENDAR_SETTINGS,
        timeZone: calendar.timeZone ?? DEFAULT_CALENDAR_SETTINGS.timeZone,
      },
      createdBy: workspace.userId,
    });
  } catch (error) {
    if (error instanceof ConnectionTakenError)
      return done(request, "error=gcal_taken");
    console.error(
      "[google-calendar] save failed:",
      error instanceof Error ? error.message : "unknown",
    );
    return done(request, "error=gcal_save");
  }

  return done(request, "connected=1&open=google_calendar");
}
