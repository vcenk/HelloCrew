import { describe, expect, it } from "vitest";

import {
  launchSteps,
  type LaunchInput,
} from "../components/dashboard/launch-steps";
import { sampleAssistantIdentity } from "../lib/assistant";
import { sampleBusiness } from "../lib/business";
import { missingWorkflowReadiness } from "../lib/workflow-readiness";

/**
 * Covers the checklist as it already behaved before a calendar step was
 * added, so that step cannot have quietly changed the rest of it.
 */
const base: LaunchInput = {
  identity: sampleAssistantIdentity,
  business: { hours: "", services: [], faqs: [] },
  workflowReadiness: missingWorkflowReadiness,
  tested: false,
  calendar: null,
};

const ids = (input: LaunchInput) => launchSteps(input).map((step) => step.id);
const step = (input: LaunchInput, id: string) =>
  launchSteps(input).find((s) => s.id === id)!;

describe("the launch checklist without a calendar", () => {
  it("is the four steps it has always been, in order", () => {
    expect(ids(base)).toEqual(["assistant", "knowledge", "workflow", "test"]);
  });

  it("counts the receptionist done once it has a name and greeting", () => {
    expect(step(base, "assistant").done).toBe(true);
    expect(
      step({ ...base, identity: { name: "", greeting: "" } }, "assistant").done,
    ).toBe(false);
  });

  it("counts approved facts across hours, services and FAQs", () => {
    const business = {
      hours: "Mon-Fri",
      services: sampleBusiness.services.slice(0, 2),
      faqs: sampleBusiness.faqs.slice(0, 1),
    };
    const expected = 1 + business.services.length + business.faqs.length;
    const knowledge = step({ ...base, business }, "knowledge");

    expect(knowledge.done).toBe(true);
    expect(knowledge.detail).toContain(`${expected} approved facts`);
  });

  it("says one fact in the singular", () => {
    const knowledge = step(
      { ...base, business: { hours: "Mon-Fri", services: [], faqs: [] } },
      "knowledge",
    );
    expect(knowledge.detail).toContain("1 approved fact:");
  });

  it("says what to do when there is no knowledge yet", () => {
    const knowledge = step(base, "knowledge");
    expect(knowledge.done).toBe(false);
    expect(knowledge.detail).toMatch(/add hours, services and faqs/i);
  });

  it("is only done on a published workflow, not a draft", () => {
    const draft = {
      ...base,
      workflowReadiness: {
        ...missingWorkflowReadiness,
        status: "draft" as const,
        name: "Bookings",
      },
    };
    expect(step(draft, "workflow").done).toBe(false);
    expect(step(draft, "workflow").detail).toMatch(/still a draft/i);

    const published = {
      ...base,
      workflowReadiness: {
        ...missingWorkflowReadiness,
        status: "published" as const,
        name: "Bookings",
        version: 2,
      },
    };
    expect(step(published, "workflow").done).toBe(true);
  });

  it("counts a conversation tested once a reply has been seen", () => {
    expect(step(base, "test").done).toBe(false);
    expect(step({ ...base, tested: true }, "test").done).toBe(true);
  });
});

describe("the calendar step", () => {
  const connected = {
    name: "salon@example.com",
    timeZone: "America/Vancouver",
    reviewed: false,
  };

  it("does not appear for a workspace with no calendar", () => {
    // Booking by hand is a supported way to run: an item that can never be
    // finished would leave the checklist permanently short.
    expect(ids(base)).not.toContain("calendar");
  });

  it("appears once a calendar is connected", () => {
    expect(ids({ ...base, calendar: connected })).toContain("calendar");
  });

  it("sits before testing a conversation", () => {
    // Testing the crew is the last thing you do, and what it offers depends
    // on these times being right.
    const order = ids({ ...base, calendar: connected });
    expect(order.indexOf("calendar")).toBeLessThan(order.indexOf("test"));
  });

  it("is unfinished until somebody confirms the timezone", () => {
    const unreviewed = step({ ...base, calendar: connected }, "calendar");
    expect(unreviewed.done).toBe(false);
    expect(unreviewed.detail).toContain("America/Vancouver");
    expect(unreviewed.detail).toContain("salon@example.com");
    expect(unreviewed.action).toMatch(/timezone/i);
  });

  it("is done once they have", () => {
    const reviewed = step(
      { ...base, calendar: { ...connected, reviewed: true } },
      "calendar",
    );
    expect(reviewed.done).toBe(true);
    expect(reviewed.detail).toContain("America/Vancouver");
  });

  it("stays on the list once done, rather than vanishing", () => {
    // A step that disappears when finished makes the count jump about and
    // hides where the setting lives.
    expect(ids({ ...base, calendar: { ...connected, reviewed: true } })).toContain(
      "calendar",
    );
  });

  it("links to the editor that sets it", () => {
    const calendar = step({ ...base, calendar: connected }, "calendar");
    expect(calendar.href).toBe("/app/connections?open=google_calendar");
  });

  it("does not change whether any other step is done", () => {
    const without = launchSteps(base);
    const with_ = launchSteps({ ...base, calendar: connected });
    for (const existing of without)
      expect(
        with_.find((s) => s.id === existing.id),
        existing.id,
      ).toEqual(existing);
  });
});
