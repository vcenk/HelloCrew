import { describe, expect, it } from "vitest";

import { buildAgentContext } from "../lib/agent/context";
import { contractsForTurn, type TurnEffects } from "../lib/agent/tools";
import { sampleAssistantIdentity } from "../lib/assistant";
import { sampleBusiness } from "../lib/business";
import {
  CalendarSettingsError,
  DEFAULT_CALENDAR_SETTINGS,
  isKnownTimeZone,
  parseCalendarSettings,
} from "../lib/calendar/account";
import { calendarContracts, type CalendarTurnEffects } from "../lib/calendar/tools";
import type { CalendarAccount, CalendarAdapter } from "../lib/calendar/types";
import { createKnowledgeStoreFromBusiness } from "../lib/knowledge";

const context = () => {
  const knowledge = createKnowledgeStoreFromBusiness(
    sampleBusiness,
    "2026-01-01T00:00:00.000Z",
  );
  const base = buildAgentContext(sampleAssistantIdentity, knowledge);
  return { ...base, skills: { ...base.skills, booking: "ask" as const } };
};

describe("calendar settings", () => {
  it("accepts the defaults a new connection is given", () => {
    expect(() => parseCalendarSettings(DEFAULT_CALENDAR_SETTINGS)).not.toThrow();
  });

  it("refuses an unknown timezone rather than guessing", () => {
    expect(() =>
      parseCalendarSettings({
        ...DEFAULT_CALENDAR_SETTINGS,
        timeZone: "Mars/Olympus",
      }),
    ).toThrow(CalendarSettingsError);
  });

  it("refuses a closing time before its opening time", () => {
    // Left alone this would quietly offer nothing and look like a full diary.
    expect(() =>
      parseCalendarSettings({
        ...DEFAULT_CALENDAR_SETTINGS,
        openingHours: { "1": [{ opens: 1020, closes: 540 }] },
      }),
    ).toThrow(/earlier than/i);
  });

  it("refuses a malformed settings object instead of defaulting to empty", () => {
    for (const bad of [null, {}, { timeZone: "Europe/London" }, "nope"])
      expect(() => parseCalendarSettings(bad), JSON.stringify(bad)).toThrow(
        CalendarSettingsError,
      );
  });

  it("knows which timezones this runtime supports", () => {
    expect(isKnownTimeZone("Europe/Istanbul")).toBe(true);
    expect(isKnownTimeZone("Not/AZone")).toBe(false);
  });
});

describe("what the model is offered", () => {
  const account: CalendarAccount = {
    provider: "google_calendar",
    calendarId: "salon@example.com",
    timeZone: "Europe/London",
    openingHours: { 1: [{ opens: 540, closes: 1020 }] },
    defaultDurationMinutes: 60,
    leadTimeMinutes: 60,
  };
  const adapter: CalendarAdapter = {
    provider: "google_calendar",
    readBusy: async () => [],
  };
  const effects = (): TurnEffects => ({
    approvals: [],
    handoffs: [],
    leads: [],
  });
  const calEffects = (): CalendarTurnEffects => ({
  proposals: [],
  offered: [],
  booked: [],
  cancellations: [],
  reschedules: [],
});

  it("hides the calendar tools when nothing is connected", () => {
    const extra = calendarContracts({
      account,
      adapter,
      effects: calEffects(),
    });
    const offered = contractsForTurn(context(), effects(), new Set(), extra);
    expect([...offered.keys()]).not.toContain("check_availability");
    expect([...offered.keys()]).not.toContain("propose_booking");
    // The built-in tools are unaffected.
    expect([...offered.keys()]).toContain("search_knowledge");
  });

  it("offers them once the calendar is connected", () => {
    const extra = calendarContracts({
      account,
      adapter,
      effects: calEffects(),
    });
    const offered = contractsForTurn(
      context(),
      effects(),
      new Set(["google_calendar"] as const),
      extra,
    );
    expect([...offered.keys()]).toContain("check_availability");
    expect([...offered.keys()]).toContain("propose_booking");
  });

  it("keeps booking approval-gated even when connected", () => {
    const extra = calendarContracts({
      account,
      adapter,
      effects: calEffects(),
    });
    const offered = contractsForTurn(
      context(),
      effects(),
      new Set(["google_calendar"] as const),
      extra,
    );
    expect(offered.get("propose_booking")!.effect).toBe("needs_approval");
    expect(offered.get("check_availability")!.effect).toBe("read_only");
  });
});
