/**
 * Turns whatever Google threw during "Connect Google Calendar" into one of the
 * codes the Connections page knows how to explain.
 *
 * It lives apart from the callback route so the pairing can be tested: these
 * regexes match Google's own wording, and a mismatch is invisible — the owner
 * just lands back on "Google didn't accept the sign-in" with nothing to act on.
 */
export type CalendarConnectError =
  | "gcal_redirect_uri"
  | "gcal_api_disabled"
  | "gcal_bad_client"
  | "gcal_invalid_grant"
  | "gcal_scope"
  | "google_login";

export function calendarConnectError(message: string): CalendarConnectError {
  if (/redirect_uri_mismatch|redirect_uri/i.test(message))
    return "gcal_redirect_uri";
  if (
    /accessNotConfigured|SERVICE_DISABLED|has not been used|is disabled/i.test(
      message,
    )
  )
    return "gcal_api_disabled";
  if (/invalid_client|unauthorized_client/i.test(message))
    return "gcal_bad_client";
  if (/invalid_grant/i.test(message)) return "gcal_invalid_grant";
  if (/insufficient|invalid_scope|ACCESS_TOKEN_SCOPE/i.test(message))
    return "gcal_scope";
  return "google_login";
}
