import { describe, expect, it, vi } from "vitest";

import { buildAgentContext } from "../lib/agent/context";
import { assertContractIsSound } from "../lib/agent/tool-contract";
import { sampleAssistantIdentity } from "../lib/assistant";
import { sampleBusiness } from "../lib/business";
import { confirmBooking, describeOutcome } from "../lib/calendar/confirm";
import { calendarContracts, type CalendarTurnEffects } from "../lib/calendar/tools";
import type {
  CalendarAccount,
  CalendarAdapter,
  CreatedEvent,
  Interval,
} from "../lib/calendar/types";
import { createKnowledgeStoreFromBusiness } from "../lib/knowledge";

const NOW = new Date("2026-01-05T06:00:00Z"); // Monday, before opening

const account: CalendarAccount = {
  provider: "google_calendar",
  calendarId: "salon@example.com",
  timeZone: "Europe/London",
  openingHours: {
    1: [{ opens: 9 * 60, closes: 17 * 60 }],
    2: [{ opens: 9 * 60, closes: 17 * 60 }],
  },
  defaultDurationMinutes: 60,
  leadTimeMinutes: 60,
};

function context(booking: "off" | "ask" | "auto" = "ask") {
  const knowledge = createKnowledgeStoreFromBusiness(
    sampleBusiness,
    "2026-01-01T00:00:00.000Z",
  );
  const base = buildAgentContext(sampleAssistantIdentity, knowledge);
  return { ...base, skills: { ...base.skills, booking } };
}

function adapterWith(
  busy: Interval[],
  overrides: Partial<CalendarAdapter> = {},
): CalendarAdapter {
  return {
    provider: "google_calendar",
    readBusy: vi.fn(async () => busy),
    createEvent: vi.fn(async (_account, event) => ({
      externalId: "evt_1",
      start: event.start,
      end: event.end,
    })),
    ...overrides,
  };
}

const tools = (adapter: CalendarAdapter, effects: CalendarTurnEffects) =>
  new Map(
    calendarContracts({ account, adapter, effects, now: () => NOW }).map((c) => [
      c.name,
      c,
    ]),
  );

const noEffects = (): CalendarTurnEffects => ({ proposals: [] });

describe("calendar tool contracts", () => {
  it("declares sound contracts", () => {
    for (const contract of calendarContracts({
      account,
      adapter: adapterWith([]),
      effects: noEffects(),
    }))
      expect(() => assertContractIsSound(contract)).not.toThrow();
  });

  it("keeps booking behind owner approval and availability free to read", () => {
    const byName = tools(adapterWith([]), noEffects());
    expect(byName.get("check_availability")!.effect).toBe("read_only");
    expect(byName.get("propose_booking")!.effect).toBe("needs_approval");
    expect(byName.get("propose_booking")!.approval).toBe("owner");
  });

  it("needs the calendar connected before it is offered at all", () => {
    for (const contract of calendarContracts({
      account,
      adapter: adapterWith([]),
      effects: noEffects(),
    }))
      expect(contract.requires).toBe("google_calendar");
  });

  it("offers no booking tool when the owner switched the skill off", () => {
    const byName = tools(adapterWith([]), noEffects());
    expect(byName.get("propose_booking")!.isEnabled(context("off"))).toBe(false);
    expect(byName.get("check_availability")!.isEnabled(context("off"))).toBe(
      false,
    );
  });
});

describe("checking availability", () => {
  it("offers real free times from the calendar", async () => {
    const byName = tools(adapterWith([]), noEffects());
    const out = JSON.parse(
      String(await byName.get("check_availability")!.run({}, context())),
    );
    expect(out.timeZone).toBe("Europe/London");
    expect(out.options).toHaveLength(3);
    expect(out.options[0].startsAt).toBe("2026-01-05T09:00:00.000Z");
    expect(out.note).toMatch(/do not invent/i);
  });

  it("works around existing appointments", async () => {
    const byName = tools(
      adapterWith([
        {
          start: new Date("2026-01-05T09:00:00Z"),
          end: new Date("2026-01-05T12:00:00Z"),
        },
      ]),
      noEffects(),
    );
    const out = JSON.parse(
      String(await byName.get("check_availability")!.run({}, context())),
    );
    expect(out.options[0].startsAt).toBe("2026-01-05T12:00:00.000Z");
  });

  it("says so plainly when there is nothing free", async () => {
    const full = adapterWith([
      {
        start: new Date("2026-01-01T00:00:00Z"),
        end: new Date("2026-02-01T00:00:00Z"),
      },
    ]);
    const out = String(
      await tools(full, noEffects()).get("check_availability")!.run({}, context()),
    );
    expect(out).toMatch(/nothing is free/i);
    expect(out).toMatch(/take their details/i);
  });

  it("fails loudly rather than calling an unreadable calendar empty", async () => {
    const broken = adapterWith([], {
      readBusy: vi.fn(async () => {
        throw new Error("Google Calendar could not read that calendar.");
      }),
    });
    await expect(
      tools(broken, noEffects()).get("check_availability")!.run({}, context()),
    ).rejects.toThrow(/could not read/i);
  });
});

describe("proposing a booking", () => {
  const propose = (adapter: CalendarAdapter, effects: CalendarTurnEffects) =>
    tools(adapter, effects).get("propose_booking")!;

  it("records the request and never claims it is booked", async () => {
    const effects = noEffects();
    const adapter = adapterWith([]);
    const out = String(
      await propose(adapter, effects).run(
        { service: "Haircut", startsAt: "2026-01-05T09:00:00.000Z" },
        context(),
      ),
    );

    expect(effects.proposals).toHaveLength(1);
    expect(out).toMatch(/awaiting_owner_approval/);
    expect(out).toMatch(/do not say it is booked/i);
    // Nothing was written to the calendar during the model's turn.
    expect(adapter.createEvent).not.toHaveBeenCalled();
  });

  it("refuses a time that has just been taken", async () => {
    const adapter = adapterWith([
      {
        start: new Date("2026-01-05T09:00:00Z"),
        end: new Date("2026-01-05T10:00:00Z"),
      },
    ]);
    const effects = noEffects();
    const out = String(
      await propose(adapter, effects).run(
        { service: "Haircut", startsAt: "2026-01-05T09:00:00.000Z" },
        context(),
      ),
    );
    expect(out).toMatch(/just been taken/i);
    expect(effects.proposals).toHaveLength(0);
  });

  it("rejects a time the model made up", async () => {
    const out = String(
      await propose(adapterWith([]), noEffects()).run(
        { service: "Haircut", startsAt: "not-a-time" },
        context(),
      ),
    );
    expect(out).toMatch(/wasn't understood/i);
  });

  it("holds only one proposal per conversation", async () => {
    const effects = noEffects();
    const tool = propose(adapterWith([]), effects);
    await tool.run(
      { service: "Haircut", startsAt: "2026-01-05T09:00:00.000Z" },
      context(),
    );
    const second = String(
      await tool.run(
        { service: "Colour", startsAt: "2026-01-05T11:00:00.000Z" },
        context(),
      ),
    );
    expect(second).toMatch(/already waiting/i);
    expect(effects.proposals).toHaveLength(1);
  });

  it("gives the same request the same idempotency key", () => {
    const tool = propose(adapterWith([]), noEffects());
    const ctx = context();
    const a = tool.idempotencyKey!(
      { service: "Haircut", startsAt: "2026-01-05T09:00:00.000Z" },
      ctx,
    );
    const b = tool.idempotencyKey!(
      { service: "  haircut ", startsAt: "2026-01-05T09:00:00Z" },
      ctx,
    );
    expect(b).toBe(a);
  });
});

describe("confirming after approval", () => {
  const proposal = {
    id: "p1",
    service: "Haircut",
    start: new Date("2026-01-05T09:00:00Z"),
    end: new Date("2026-01-05T10:00:00Z"),
    customerName: "Sam",
    idempotencyKey: "calendar:haircut:2026-01-05T09:00:00.000Z",
  };

  it("writes the appointment once the owner approves", async () => {
    const adapter = adapterWith([]);
    const outcome = await confirmBooking({
      account,
      adapter,
      proposal,
      now: NOW,
    });
    expect(outcome.status).toBe("booked");
    expect(adapter.createEvent).toHaveBeenCalledOnce();
    // The proposal's key travels to the provider, so approving twice writes once.
    expect(vi.mocked(adapter.createEvent!).mock.calls[0][1]).toMatchObject({
      idempotencyKey: proposal.idempotencyKey,
      title: "Haircut — Sam",
    });
  });

  it("does not book a slot taken while the owner was deciding", async () => {
    const adapter = adapterWith([
      {
        start: new Date("2026-01-05T09:00:00Z"),
        end: new Date("2026-01-05T10:00:00Z"),
      },
    ]);
    const outcome = await confirmBooking({
      account,
      adapter,
      proposal,
      now: NOW,
    });
    expect(outcome.status).toBe("no_longer_free");
    expect(adapter.createEvent).not.toHaveBeenCalled();
  });

  it("refuses an approval that arrived after the appointment", async () => {
    const outcome = await confirmBooking({
      account,
      adapter: adapterWith([]),
      proposal,
      now: new Date("2026-01-06T00:00:00Z"),
    });
    expect(outcome.status).toBe("no_longer_free");
  });

  it("tells the owner to book it themselves when the provider cannot be written to", async () => {
    // Fresha and Booksy: approval still works, HelloCrew just cannot write.
    const readOnly: CalendarAdapter = {
      provider: "ical",
      readBusy: async () => [],
    };
    const outcome = await confirmBooking({
      account,
      adapter: readOnly,
      proposal,
      now: NOW,
    });
    expect(outcome.status).toBe("owner_books");
    expect(describeOutcome(outcome)).toMatch(/needs adding there/i);
  });

  it("never reports a booking the provider refused", async () => {
    const adapter = adapterWith([], {
      createEvent: vi.fn(async () => {
        throw new Error("Conflict");
      }),
    });
    const outcome = await confirmBooking({
      account,
      adapter,
      proposal,
      now: NOW,
    });
    expect(outcome.status).toBe("failed");
    expect(describeOutcome(outcome)).toMatch(/^Not booked/);
    expect(describeOutcome(outcome)).not.toMatch(/added to the calendar/i);
  });

  it("describes every outcome in words that match what happened", async () => {
    expect(
      describeOutcome({ status: "no_longer_free" }),
    ).toMatch(/nothing was booked/i);
    expect(
      describeOutcome({
        status: "booked",
        event: { externalId: "e", start: NOW, end: NOW },
      }),
    ).toMatch(/added to the calendar/i);
  });
});

/**
 * Found by the live check against a real Google Calendar: the first approval
 * booked, and the second one re-read the calendar, saw the event it had just
 * written, and reported "no longer free" — telling the owner nothing was
 * booked when something was.
 */
describe("approving the same booking twice", () => {
  const slot = {
    start: new Date(NOW.getTime() + 60 * 60 * 1000),
    end: new Date(NOW.getTime() + 2 * 60 * 60 * 1000),
  };
  const proposal = {
    id: "p1",
    service: "Cut",
    start: slot.start,
    end: slot.end,
    idempotencyKey: "key-1",
  };

  /** A calendar that reports what it has been told to write. */
  function recordingAdapter(): CalendarAdapter {
    const written: { key: string; event: CreatedEvent }[] = [];
    return {
      provider: "google_calendar",
      // Once written, the slot reads as busy — exactly what Google does.
      readBusy: vi.fn(async () => written.map((entry) => entry.event)),
      findEvent: vi.fn(
        async (_account, key) =>
          written.find((entry) => entry.key === key)?.event ?? null,
      ),
      createEvent: vi.fn(async (_account, event) => {
        const created: CreatedEvent = {
          externalId: `evt_${written.length + 1}`,
          start: event.start,
          end: event.end,
        };
        written.push({ key: event.idempotencyKey, event: created });
        return created;
      }),
    };
  }

  it("reports the booking that exists, not a lost slot", async () => {
    const adapter = recordingAdapter();
    const first = await confirmBooking({ account, adapter, proposal, now: NOW });
    expect(first.status).toBe("booked");

    const second = await confirmBooking({ account, adapter, proposal, now: NOW });
    expect(second.status).toBe("booked");
    if (first.status !== "booked" || second.status !== "booked") return;
    expect(second.event.externalId).toBe(first.event.externalId);
  });

  it("writes the appointment only once", async () => {
    const adapter = recordingAdapter();
    await confirmBooking({ account, adapter, proposal, now: NOW });
    await confirmBooking({ account, adapter, proposal, now: NOW });
    expect(adapter.createEvent).toHaveBeenCalledTimes(1);
  });

  it("never tells the owner nothing was booked when it was", async () => {
    const adapter = recordingAdapter();
    await confirmBooking({ account, adapter, proposal, now: NOW });
    const second = await confirmBooking({ account, adapter, proposal, now: NOW });
    expect(describeOutcome(second)).not.toMatch(/nothing was booked/i);
  });

  it("still refuses a slot someone else took", async () => {
    // Busy for a different reason: no event of ours carries this key.
    const adapter = adapterWith([slot]);
    const outcome = await confirmBooking({
      account,
      adapter,
      proposal,
      now: NOW,
    });
    expect(outcome.status).toBe("no_longer_free");
    expect(adapter.createEvent).not.toHaveBeenCalled();
  });

  it("an adapter with no lookup still books once and says so", async () => {
    // Adapters are allowed to omit findEvent; the flow must not depend on it.
    const adapter = adapterWith([]);
    const outcome = await confirmBooking({
      account,
      adapter,
      proposal,
      now: NOW,
    });
    expect(outcome.status).toBe("booked");
  });
});
