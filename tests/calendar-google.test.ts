import { describe, expect, it, vi } from "vitest";

import {
  CalendarApiError,
  googleCalendarAdapter,
  GOOGLE_CALENDAR_SCOPE,
  GOOGLE_CALENDAR_SCOPES,
} from "../lib/calendar/google-calendar";
import { canWrite } from "../lib/calendar/types";
import type { CalendarAccount } from "../lib/calendar/types";

const account: CalendarAccount = {
  provider: "google_calendar",
  calendarId: "salon@example.com",
  timeZone: "Europe/London",
  openingHours: { 1: [{ opens: 540, closes: 1020 }] },
  defaultDurationMinutes: 60,
  leadTimeMinutes: 60,
};

const window = {
  start: new Date("2026-01-05T00:00:00Z"),
  end: new Date("2026-01-06T00:00:00Z"),
};

/** A fetch stand-in that answers from a queue and records what it was asked. */
function stubFetch(responses: { ok?: boolean; status?: number; body: unknown }[]) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const next = responses.shift() ?? { body: {} };
    return {
      ok: next.ok ?? true,
      status: next.status ?? 200,
      json: async () => next.body,
    } as Response;
  });
  return { fetcher: fetcher as unknown as typeof fetch, calls };
}

const adapter = (fetcher: typeof fetch) =>
  googleCalendarAdapter({ accessToken: async () => "token", fetcher });

describe("reading free/busy", () => {
  it("returns the busy intervals as instants", async () => {
    const { fetcher, calls } = stubFetch([
      {
        body: {
          calendars: {
            "salon@example.com": {
              busy: [
                { start: "2026-01-05T09:00:00Z", end: "2026-01-05T10:00:00Z" },
              ],
            },
          },
        },
      },
    ]);

    const busy = await adapter(fetcher).readBusy(account, window);
    expect(busy).toHaveLength(1);
    expect(busy[0].start.toISOString()).toBe("2026-01-05T09:00:00.000Z");

    expect(calls[0].url).toContain("/freeBusy");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({
      items: [{ id: "salon@example.com" }],
      timeZone: "Europe/London",
    });
  });

  it("treats an empty calendar as genuinely free", async () => {
    const { fetcher } = stubFetch([
      { body: { calendars: { "salon@example.com": { busy: [] } } } },
    ]);
    expect(await adapter(fetcher).readBusy(account, window)).toEqual([]);
  });

  it("refuses to call a calendar it could not read 'free'", async () => {
    // The dangerous case: Google answers 200 but reports a per-calendar
    // error. Reading that as "no busy time" would book over real appointments.
    const { fetcher } = stubFetch([
      {
        body: {
          calendars: {
            "salon@example.com": { errors: [{ reason: "notFound" }] },
          },
        },
      },
    ]);
    await expect(adapter(fetcher).readBusy(account, window)).rejects.toThrow(
      /could not read/i,
    );
  });

  it("asks the owner to reconnect when access is revoked", async () => {
    const { fetcher } = stubFetch([
      { ok: false, status: 403, body: { error: { message: "Forbidden" } } },
    ]);
    await expect(adapter(fetcher).readBusy(account, window)).rejects.toThrow(
      /reconnect google calendar/i,
    );
  });

  it("surfaces Google's own message for other failures", async () => {
    const { fetcher } = stubFetch([
      { ok: false, status: 500, body: { error: { message: "Backend error" } } },
    ]);
    await expect(adapter(fetcher).readBusy(account, window)).rejects.toThrow(
      /backend error/i,
    );
  });
});

describe("writing an appointment", () => {
  const event = {
    start: new Date("2026-01-05T09:00:00Z"),
    end: new Date("2026-01-05T10:00:00Z"),
    title: "Haircut — Sam",
    notes: "Approved in HelloCrew",
    idempotencyKey: "booking:haircut:friday-2pm",
  };

  it("checks for the same booking before writing a new one", async () => {
    const { fetcher, calls } = stubFetch([
      { body: { items: [] } },
      {
        body: {
          id: "evt_1",
          htmlLink: "https://calendar.google.com/evt_1",
          start: { dateTime: "2026-01-05T09:00:00Z" },
          end: { dateTime: "2026-01-05T10:00:00Z" },
        },
      },
    ]);

    const created = await adapter(fetcher).createEvent!(account, event);
    expect(created.externalId).toBe("evt_1");

    // Looked first, wrote second.
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toContain("privateExtendedProperty");
    expect(calls[0].url).toContain(encodeURIComponent(event.idempotencyKey));
    expect(calls[1].method).toBe("POST");

    // The key is stored on the event so the next retry can find it.
    expect(calls[1].body).toMatchObject({
      extendedProperties: { private: { hellocrewKey: event.idempotencyKey } },
    });
  });

  it("returns the original instead of double-booking on a replay", async () => {
    const { fetcher, calls } = stubFetch([
      {
        body: {
          items: [
            {
              id: "evt_original",
              htmlLink: "https://calendar.google.com/evt_original",
              start: { dateTime: "2026-01-05T09:00:00Z" },
              end: { dateTime: "2026-01-05T10:00:00Z" },
            },
          ],
        },
      },
    ]);

    const created = await adapter(fetcher).createEvent!(account, event);
    expect(created.externalId).toBe("evt_original");
    // One call: the lookup. Nothing was written.
    expect(calls).toHaveLength(1);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("sends the business timezone with the times", async () => {
    const { fetcher, calls } = stubFetch([
      { body: { items: [] } },
      { body: { id: "evt_2" } },
    ]);
    await adapter(fetcher).createEvent!(account, event);
    expect(calls[1].body).toMatchObject({
      start: { timeZone: "Europe/London" },
      end: { timeZone: "Europe/London" },
    });
  });

  it("does not claim success when Google rejects the write", async () => {
    const { fetcher } = stubFetch([
      { body: { items: [] } },
      { ok: false, status: 409, body: { error: { message: "Conflict" } } },
    ]);
    await expect(
      adapter(fetcher).createEvent!(account, event),
    ).rejects.toBeInstanceOf(CalendarApiError);
  });
});

describe("adapters without write access", () => {
  it("reports whether HelloCrew can book, or only propose", () => {
    const { fetcher } = stubFetch([]);
    expect(canWrite(adapter(fetcher))).toBe(true);

    // Fresha publishes no booking API and Booksy's is partnership-only. An
    // adapter that can only read still supports propose-and-approve.
    const readOnly = {
      provider: "ical" as const,
      readBusy: async () => [],
    };
    expect(canWrite(readOnly)).toBe(false);
  });
});

/**
 * Google's scopes are per-endpoint, and the mismatch is silent: a token with
 * only calendar.events signs in, stores happily, and then 403s on the first
 * real call. This pins each endpoint the adapter calls to the scopes Google
 * documents for it, so dropping one from the OAuth request fails here first.
 *
 * Tables taken from developers.google.com/workspace/calendar/api/v3/reference.
 */
describe("the scopes the connection has to ask for", () => {
  const accepts: Record<string, string[]> = {
    "calendarList.list": [
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/calendar.calendarlist",
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    ],
    "freeBusy.query": [
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/calendar.events.freebusy",
      "https://www.googleapis.com/auth/calendar.freebusy",
    ],
    "events.insert": [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/calendar.events",
    ],
    "events.list": [
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.events.readonly",
    ],
  };

  it.each(Object.keys(accepts))("%s is covered by what we request", (endpoint) => {
    const granted = GOOGLE_CALENDAR_SCOPES as readonly string[];
    expect(accepts[endpoint].some((scope) => granted.includes(scope))).toBe(true);
  });

  it("asks for no scope it does not need", () => {
    const needed = new Set(Object.values(accepts).flat());
    for (const scope of GOOGLE_CALENDAR_SCOPES) expect(needed).toContain(scope);
  });

  it("stays away from reading every event on every calendar", () => {
    const granted = GOOGLE_CALENDAR_SCOPES as readonly string[];
    expect(granted).not.toContain("https://www.googleapis.com/auth/calendar");
    expect(granted).not.toContain(
      "https://www.googleapis.com/auth/calendar.readonly",
    );
  });

  it("sends them to Google space-separated", () => {
    expect(GOOGLE_CALENDAR_SCOPE.split(" ")).toEqual([...GOOGLE_CALENDAR_SCOPES]);
  });
});

describe("cancelling through Google", () => {
  const key = "calendar:haircut:2026-01-05T09:00:00.000Z";
  const existing = {
    items: [
      {
        id: "evt_1",
        start: { dateTime: "2026-01-05T09:00:00Z" },
        end: { dateTime: "2026-01-05T10:00:00Z" },
      },
    ],
  };

  it("deletes the event it wrote under that key", async () => {
    const { fetcher, calls } = stubFetch([
      { body: existing },
      { status: 204, body: {} },
    ]);
    const result = await adapter(fetcher).cancelEvent!(account, key);

    expect(result).toBe("cancelled");
    // Found by our own key, never by matching a name or a time.
    expect(calls[0].url).toContain(encodeURIComponent(`hellocrewKey=${key}`));
    expect(calls[1].method).toBe("DELETE");
    expect(calls[1].url).toContain("/events/evt_1");
  });

  it("does not call Google when there is nothing under that key", async () => {
    const { fetcher, calls } = stubFetch([{ body: { items: [] } }]);
    const result = await adapter(fetcher).cancelEvent!(account, key);

    expect(result).toBe("already_gone");
    expect(calls).toHaveLength(1);
  });

  it.each([404, 410])(
    "treats %s from the delete as already gone",
    async (status) => {
      // Somebody removed it in the calendar first. The slot is free, which
      // is the outcome asked for, so it must not surface as a failure.
      const { fetcher } = stubFetch([
        { body: existing },
        { ok: false, status, body: { error: { message: "Not Found" } } },
      ]);
      expect(await adapter(fetcher).cancelEvent!(account, key)).toBe(
        "already_gone",
      );
    },
  );

  it("keeps Google's reason when it refuses for any other cause", async () => {
    const { fetcher } = stubFetch([
      { body: existing },
      {
        ok: false,
        status: 403,
        body: { error: { message: "Insufficient permissions" } },
      },
    ]);
    await expect(adapter(fetcher).cancelEvent!(account, key)).rejects.toThrow(
      /insufficient permissions/i,
    );
  });

  it("is offered alongside writing, so the pair stays in step", () => {
    // An adapter that can create but not cancel would strand appointments.
    const { fetcher } = stubFetch([]);
    const built = adapter(fetcher);
    expect(canWrite(built)).toBe(true);
    expect(typeof built.cancelEvent).toBe("function");
  });
});
