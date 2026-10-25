import type {
  CalendarAccount,
  CalendarAdapter,
  CreatedEvent,
  Interval,
} from "./types";

/**
 * Google Calendar, adapter #1.
 *
 * Google is not what most salons run on — they run on Fresha, Vagaro, Booksy
 * or Square. It is first because it is the only one with open, self-serve
 * access, which makes it the reference implementation of the adapter and the
 * right fit for operators with no booking platform at all.
 *
 * Scope needed: https://www.googleapis.com/auth/calendar.events
 * Reading free/busy alone needs only .readonly.
 */
export const GOOGLE_CALENDAR_SCOPE =
  "https://www.googleapis.com/auth/calendar.events";
export const GOOGLE_CALENDAR_READ_SCOPE =
  "https://www.googleapis.com/auth/calendar.readonly";

export class CalendarApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CalendarApiError";
  }
}

type Fetcher = typeof fetch;

async function call<T>(
  fetcher: Fetcher,
  token: string,
  url: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetcher(url, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });

  const data = (await response.json().catch(() => ({}))) as T & {
    error?: { message?: string };
  };

  if (!response.ok)
    throw new CalendarApiError(
      response.status === 401 || response.status === 403
        ? "Reconnect Google Calendar: HelloCrew no longer has access."
        : (data.error?.message ?? `Google Calendar failed (${response.status}).`),
      response.status,
    );

  return data;
}

type FreeBusyResponse = {
  calendars?: Record<
    string,
    { busy?: { start: string; end: string }[]; errors?: { reason: string }[] }
  >;
};

/**
 * Builds the adapter for one connected account.
 *
 * `accessToken` is a function because tokens expire mid-conversation; the
 * caller refreshes however its provider does.
 */
export function googleCalendarAdapter(options: {
  accessToken: () => Promise<string>;
  fetcher?: Fetcher;
}): CalendarAdapter {
  const fetcher = options.fetcher ?? fetch;

  return {
    provider: "google_calendar",

    async readBusy(
      account: CalendarAccount,
      window: Interval,
    ): Promise<Interval[]> {
      const token = await options.accessToken();
      const data = await call<FreeBusyResponse>(
        fetcher,
        token,
        "https://www.googleapis.com/calendar/v3/freeBusy",
        {
          method: "POST",
          body: {
            timeMin: window.start.toISOString(),
            timeMax: window.end.toISOString(),
            timeZone: account.timeZone,
            items: [{ id: account.calendarId }],
          },
        },
      );

      const calendar = data.calendars?.[account.calendarId];
      // A calendar that reports an error is not an empty calendar. Treating
      // it as free would propose a time on top of an existing appointment.
      if (calendar?.errors?.length)
        throw new CalendarApiError(
          `Google Calendar could not read "${account.calendarId}" (${calendar.errors[0].reason}).`,
        );

      return (calendar?.busy ?? []).map((slot) => ({
        start: new Date(slot.start),
        end: new Date(slot.end),
      }));
    },

    async createEvent(account, event): Promise<CreatedEvent> {
      const token = await options.accessToken();

      // Google has no idempotency header for insert, so the key is carried in
      // the event's private metadata and looked for first. A retry, a
      // duplicate webhook or a replayed approval finds the original instead
      // of writing a second appointment.
      const existing = await call<{
        items?: { id: string; start?: { dateTime?: string }; end?: { dateTime?: string }; htmlLink?: string }[];
      }>(
        fetcher,
        token,
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
          account.calendarId,
        )}/events?privateExtendedProperty=${encodeURIComponent(
          `hellocrewKey=${event.idempotencyKey}`,
        )}&maxResults=1`,
      );

      const already = existing.items?.[0];
      if (already)
        return {
          externalId: already.id,
          start: new Date(already.start?.dateTime ?? event.start),
          end: new Date(already.end?.dateTime ?? event.end),
          url: already.htmlLink,
        };

      const created = await call<{
        id: string;
        htmlLink?: string;
        start?: { dateTime?: string };
        end?: { dateTime?: string };
      }>(
        fetcher,
        token,
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
          account.calendarId,
        )}/events`,
        {
          method: "POST",
          body: {
            summary: event.title,
            description: event.notes,
            start: {
              dateTime: event.start.toISOString(),
              timeZone: account.timeZone,
            },
            end: {
              dateTime: event.end.toISOString(),
              timeZone: account.timeZone,
            },
            extendedProperties: {
              private: { hellocrewKey: event.idempotencyKey },
            },
          },
        },
      );

      return {
        externalId: created.id,
        start: new Date(created.start?.dateTime ?? event.start),
        end: new Date(created.end?.dateTime ?? event.end),
        url: created.htmlLink,
      };
    },
  };
}
