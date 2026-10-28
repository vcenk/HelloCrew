import { describe, expect, it, vi } from "vitest";

import { buildAgentContext } from "../lib/agent/context";
import { assertContractIsSound } from "../lib/agent/tool-contract";
import { sampleAssistantIdentity } from "../lib/assistant";
import { sampleBusiness } from "../lib/business";
import {
  calendarApprovalDetails,
  calendarProposalFromApproval,
} from "../lib/calendar/approval";
import { confirmBooking, describeOutcome } from "../lib/calendar/confirm";
import {
  calendarContracts,
  type BookingProposal,
  type CalendarTurnEffects,
} from "../lib/calendar/tools";
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

const noEffects = (): CalendarTurnEffects => ({
  proposals: [],
  offered: [],
  booked: [],
  cancellations: [],
  reschedules: [],
});

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

/**
 * Offers times the way a real turn does. propose_booking picks by number
 * from what check_availability just produced, so a test that skips this is
 * testing a sequence the model is not allowed to perform.
 */
async function offerTimes(
  adapter: CalendarAdapter,
  effects: CalendarTurnEffects,
) {
  return JSON.parse(
    String(
      await tools(adapter, effects)
        .get("check_availability")!
        .run({}, context()),
    ),
  ) as { timeZone: string; note: string; options: { option: number; says: string }[] };
}

describe("checking availability", () => {
  it("offers real free times from the calendar", async () => {
    const byName = tools(adapterWith([]), noEffects());
    const out = JSON.parse(
      String(await byName.get("check_availability")!.run({}, context())),
    );
    expect(out.timeZone).toBe("Europe/London");
    expect(out.options).toHaveLength(3);
    expect(out.options[0].option).toBe(1);
    expect(out.options[0].says).toMatch(/09:00/);
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
    expect(out.options[0].says).toMatch(/12:00/);
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
    await offerTimes(adapter, effects);
    const out = String(
      await propose(adapter, effects).run(
        { service: "Haircut", option: 1 },
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
    // Offered while it was free, taken by the time the customer chose it.
    effects.offered = [
      {
        start: new Date("2026-01-05T09:00:00Z"),
        end: new Date("2026-01-05T10:00:00Z"),
      },
    ];
    const out = String(
      await propose(adapter, effects).run(
        { service: "Haircut", option: 1 },
        context(),
      ),
    );
    expect(out).toMatch(/just been taken/i);
    expect(effects.proposals).toHaveLength(0);
  });

  it("books without a separate check first, from the calendar's own list", async () => {
    // A model that proposes straight away must not have to spend a round
    // being told to look: it ran out of rounds doing exactly that, and told
    // the customer a booking was being requested when none was.
    const effects = noEffects();
    const out = String(
      await propose(adapterWith([]), effects).run(
        { service: "Haircut", option: 1 },
        context(),
      ),
    );
    expect(out).toMatch(/awaiting_owner_approval/);
    expect(effects.proposals[0].start.toISOString()).toBe(
      "2026-01-05T09:00:00.000Z",
    );
  });

  it("numbers the options the same whichever tool worked them out", async () => {
    const direct = noEffects();
    await propose(adapterWith([]), direct).run(
      { service: "Haircut", option: 2 },
      context(),
    );

    const afterCheck = noEffects();
    const adapter = adapterWith([]);
    await offerTimes(adapter, afterCheck);
    await propose(adapter, afterCheck).run(
      { service: "Haircut", option: 2 },
      context(),
    );

    expect(direct.proposals[0].start.toISOString()).toBe(
      afterCheck.proposals[0].start.toISOString(),
    );
  });

  it("says what is on offer when the number is not one of them", async () => {
    const effects = noEffects();
    const out = String(
      await propose(adapterWith([]), effects).run(
        { service: "Haircut", option: 3 + 1 },
        context(),
      ),
    );
    expect(out).toMatch(/no option 4/i);
    // The model is handed the real times rather than left to guess again.
    expect(out).toMatch(/09:00/);
    expect(effects.proposals).toEqual([]);
  });

  it("refuses an option number that was never on offer", async () => {
    const effects = noEffects();
    const adapter = adapterWith([]);
    const offered = await offerTimes(adapter, effects);
    const out = String(
      await propose(adapter, effects).run(
        { service: "Haircut", option: offered.options.length + 1 },
        context(),
      ),
    );
    expect(out).toMatch(/no option/i);
    expect(effects.proposals).toEqual([]);
  });

  it("books the instant behind the number, not the number", async () => {
    const effects = noEffects();
    const adapter = adapterWith([]);
    await offerTimes(adapter, effects);
    await propose(adapter, effects).run(
      { service: "Haircut", option: 2 },
      context(),
    );
    // Option 2 is the second time the calendar offered: 09:15.
    expect(effects.proposals[0].start.toISOString()).toBe(
      "2026-01-05T09:15:00.000Z",
    );
  });

  it("holds only one proposal per conversation", async () => {
    const effects = noEffects();
    const adapter = adapterWith([]);
    await offerTimes(adapter, effects);
    const tool = propose(adapter, effects);
    await tool.run({ service: "Haircut", option: 1 }, context());
    const second = String(
      await tool.run({ service: "Colour", option: 2 }, context()),
    );
    expect(second).toMatch(/already waiting/i);
    expect(effects.proposals).toHaveLength(1);
  });

  it("gives the same request the same idempotency key", async () => {
    const effects = noEffects();
    const adapter = adapterWith([]);
    await offerTimes(adapter, effects);
    const tool = propose(adapter, effects);
    const ctx = context();
    const a = tool.idempotencyKey!({ service: "Haircut", option: 1 }, ctx);
    const b = tool.idempotencyKey!({ service: "  haircut ", option: 1 }, ctx);
    expect(b).toBe(a);
    // The key names the instant, not the option number, which means nothing
    // once the turn is over.
    expect(a).toContain("2026-01-05T09:00:00.000Z");
  });
});

describe("confirming after approval", () => {
  const proposal = {
    id: "p1",
    service: "Haircut",
    start: new Date("2026-01-05T09:00:00Z"),
    end: new Date("2026-01-05T10:00:00Z"),
    says: "Monday at 09:00",
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
    says: "Monday at 10:00",
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

/**
 * The gap between the two halves: propose_booking recorded a proposal that
 * nothing ever read, so the crew told the customer their time had been sent
 * to the business and the owner was never shown anything to approve.
 */
describe("from the crew's proposal to the owner's decision", () => {
  it("a proposed time carries everything the approval needs", async () => {
    const effects = noEffects();
    const adapter = adapterWith([]);
    await offerTimes(adapter, effects);
    await tools(adapter, effects)
      .get("propose_booking")!
      .run({ service: "Haircut", option: 1, customerName: "Sam" }, context());

    expect(effects.proposals).toHaveLength(1);
    const [proposal] = effects.proposals;

    // Everything the owner's approval will need, hours later, in another
    // request, with the agent turn long gone.
    const details = calendarApprovalDetails(proposal);
    const restored = calendarProposalFromApproval("approval-1", details);
    expect(restored).not.toBeNull();
    expect(restored!.start.toISOString()).toBe("2026-01-05T09:00:00.000Z");
    expect(restored!.idempotencyKey).toBe(proposal.idempotencyKey);
  });

  it("says the time in the business's own words, not as an instant", async () => {
    const effects = noEffects();
    const adapter = adapterWith([]);
    await offerTimes(adapter, effects);
    await tools(adapter, effects)
      .get("propose_booking")!
      .run({ service: "Haircut", option: 1 }, context());

    // The owner's card must not read "2026-01-05T09:00:00.000Z".
    expect(effects.proposals[0].says).toBeTruthy();
    expect(effects.proposals[0].says).not.toMatch(/\dT\d|Z$/);
  });

  it("approving what was proposed books that exact slot", async () => {
    const effects = noEffects();
    const adapter = adapterWith([]);
    await offerTimes(adapter, effects);
    await tools(adapter, effects)
      .get("propose_booking")!
      .run({ service: "Haircut", option: 1 }, context());

    const restored = calendarProposalFromApproval(
      "approval-1",
      JSON.parse(JSON.stringify(calendarApprovalDetails(effects.proposals[0]))),
    )!;
    const outcome = await confirmBooking({
      account,
      adapter,
      proposal: restored,
      now: new Date("2026-01-04T00:00:00Z"),
    });

    expect(outcome.status).toBe("booked");
    if (outcome.status !== "booked") return;
    expect(outcome.event.start.toISOString()).toBe("2026-01-05T09:00:00.000Z");
  });
});




/**
 * Cancelling is the mirror of booking and is held to the same two rules: the
 * owner decides, and nobody is told it happened until the calendar says so.
 */
describe("cancelling an appointment", () => {
  const booked = (over: Partial<BookingProposal> = {}): BookingProposal => ({
    id: "b1",
    service: "Haircut",
    start: new Date("2026-01-05T09:00:00Z"),
    end: new Date("2026-01-05T10:00:00Z"),
    says: "Monday 5 January at 09:00",
    idempotencyKey: "calendar:haircut:2026-01-05T09:00:00.000Z",
    ...over,
  });

  const cancelTool = (adapter: CalendarAdapter, effects: CalendarTurnEffects) =>
    tools(adapter, effects).get("cancel_booking")!;

  it("records the request and never claims it is cancelled", async () => {
    const effects = { ...noEffects(), booked: [booked()] };
    const adapter = adapterWith([]);
    const out = String(
      await cancelTool(adapter, effects).run({ booking: 1 }, context()),
    );

    expect(effects.cancellations).toHaveLength(1);
    expect(out).toMatch(/awaiting_owner_approval/);
    expect(out).toMatch(/do not say it is cancelled/i);
  });

  it("refuses when the customer has nothing booked", async () => {
    // The crew must not go looking through the calendar for a near match.
    const effects = noEffects();
    const out = String(
      await cancelTool(adapterWith([]), effects).run({ booking: 1 }, context()),
    );

    expect(out).toMatch(/no appointments booked through us/i);
    expect(effects.cancellations).toEqual([]);
  });

  it("lists what they do have when the number is wrong", async () => {
    const effects = { ...noEffects(), booked: [booked()] };
    const out = String(
      await cancelTool(adapterWith([]), effects).run({ booking: 2 }, context()),
    );

    expect(out).toMatch(/no appointment 2/i);
    expect(out).toContain("Monday 5 January at 09:00");
    expect(effects.cancellations).toEqual([]);
  });

  it("asks once, however many times the customer repeats it", async () => {
    const effects = { ...noEffects(), booked: [booked()] };
    const adapter = adapterWith([]);
    await cancelTool(adapter, effects).run({ booking: 1 }, context());
    const second = String(
      await cancelTool(adapter, effects).run({ booking: 1 }, context()),
    );

    expect(second).toMatch(/already waiting/i);
    expect(effects.cancellations).toHaveLength(1);
  });

  it("keys the cancellation to the booking it cancels", () => {
    const effects = { ...noEffects(), booked: [booked()] };
    const key = cancelTool(adapterWith([]), effects).idempotencyKey!(
      { booking: 1 },
      context(),
    );
    expect(key).toContain("calendar:haircut:2026-01-05T09:00:00.000Z");
    expect(key).toContain("cancel");
  });

  it("writes nothing to the calendar during the turn", async () => {
    const effects = { ...noEffects(), booked: [booked()] };
    const adapter = adapterWith([]);
    await cancelTool(adapter, effects).run({ booking: 1 }, context());
    expect(adapter.createEvent).not.toHaveBeenCalled();
  });
});

describe("asking to move an appointment", () => {
  const existing = (): BookingProposal => ({
    id: "b1",
    service: "Haircut",
    start: new Date("2026-01-05T12:00:00Z"),
    end: new Date("2026-01-05T13:00:00Z"),
    says: "Monday 5 January at 12:00",
    idempotencyKey: "calendar:haircut:2026-01-05T12:00:00.000Z",
  });
  const move = (adapter: CalendarAdapter, effects: CalendarTurnEffects) =>
    tools(adapter, effects).get("reschedule_booking")!;

  it("records the move and never claims it has happened", async () => {
    const effects = { ...noEffects(), booked: [existing()] };
    const adapter = adapterWith([]);
    const out = String(
      await move(adapter, effects).run({ booking: 1, option: 1 }, context()),
    );

    expect(effects.reschedules).toHaveLength(1);
    expect(out).toMatch(/awaiting_owner_approval/);
    expect(out).toMatch(/do not say it is moved/i);
    expect(adapter.createEvent).not.toHaveBeenCalled();
    expect(adapter.cancelEvent).toBeUndefined();
  });

  it("keeps the service and length of the appointment it moves", async () => {
    const effects = { ...noEffects(), booked: [existing()] };
    await move(adapterWith([]), effects).run(
      { booking: 1, option: 1 },
      context(),
    );
    const { from, to } = effects.reschedules[0];

    expect(to.service).toBe(from.service);
    expect(to.end.getTime() - to.start.getTime()).toBe(
      from.end.getTime() - from.start.getTime(),
    );
    // The new time comes from the calendar's own list, never from the move.
    expect(to.start.toISOString()).toBe("2026-01-05T09:00:00.000Z");
  });

  it("refuses to move a time to itself", async () => {
    const effects = {
      ...noEffects(),
      booked: [
        { ...existing(), start: new Date("2026-01-05T09:00:00Z"), end: new Date("2026-01-05T10:00:00Z") },
      ],
    };
    const out = String(
      await move(adapterWith([]), effects).run(
        { booking: 1, option: 1 },
        context(),
      ),
    );

    expect(out).toMatch(/already have/i);
    expect(effects.reschedules).toEqual([]);
  });

  it("refuses when the customer has nothing to move", async () => {
    const effects = noEffects();
    const out = String(
      await move(adapterWith([]), effects).run(
        { booking: 1, option: 1 },
        context(),
      ),
    );
    expect(out).toMatch(/no appointments booked through us/i);
    expect(effects.reschedules).toEqual([]);
  });

  it("asks once, however many times the customer repeats it", async () => {
    const effects = { ...noEffects(), booked: [existing()] };
    const adapter = adapterWith([]);
    await move(adapter, effects).run({ booking: 1, option: 1 }, context());
    const second = String(
      await move(adapter, effects).run({ booking: 1, option: 2 }, context()),
    );

    expect(second).toMatch(/already waiting/i);
    expect(effects.reschedules).toHaveLength(1);
  });

  it("works without a separate availability check first", async () => {
    // Same lesson as booking: being told to look first costs a round, and
    // the turn can run out before it ever asks.
    const effects = { ...noEffects(), booked: [existing()] };
    const out = String(
      await move(adapterWith([]), effects).run(
        { booking: 1, option: 2 },
        context(),
      ),
    );
    expect(out).toMatch(/awaiting_owner_approval/);
  });
});
