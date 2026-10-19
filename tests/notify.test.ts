import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import { afterEach, describe, expect, it } from "vitest";

import { describeEvent, notifyOwner } from "../lib/server/notify";

// A tiny stand-in for the service-role client: returns the given settings row.
function fakeAdmin(settings: Record<string, unknown> | null, ownerEmail = "owner@salon.com") {
  const chain = (row: unknown) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit"]) q[m] = () => q;
    q.maybeSingle = async () => ({ data: row });
    return q;
  };
  return {
    from: (table: string) => chain(table === "hc_memberships" ? { user_id: "u1" } : settings),
    auth: { admin: { getUserById: async () => ({ data: { user: { email: ownerEmail } } }) } },
  } as never;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("owner email alerts", () => {
  it("writes short, actionable emails", () => {
    const lead = describeEvent(
      { kind: "lead", conversationId: "c1", name: "Sam", contact: "604 555 0101", interest: "Balayage quote" },
      "https://hellocrew.vercel.app",
    );
    expect(lead.subject).toBe("New lead: Sam");
    expect(lead.url).toBe("https://hellocrew.vercel.app/app/conversations?c=c1");
    expect(describeEvent({ kind: "approval", conversationId: "c2", summary: "Haircut, Friday 3pm" }, "https://x.app").subject).toBe(
      "Booking request: Haircut, Friday 3pm",
    );
  });

  it("stays silent without an email key", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await notifyOwner(fakeAdmin(null), "t1", { kind: "test" })).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("respects the owner's choices and falls back to the sign-in email", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://hellocrew.vercel.app");
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const off = { email: null, on_approval: true, on_handoff: true, on_lead: false, on_new_chat: false };
    expect(
      await notifyOwner(fakeAdmin(off), "t1", { kind: "lead", conversationId: null, name: "Sam", contact: "x", interest: "y" }),
    ).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();

    expect(await notifyOwner(fakeAdmin(off), "t1", { kind: "handoff", conversationId: "c1", title: "Refund please" })).toBe(true);
    const body = JSON.parse((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.to).toEqual(["owner@salon.com"]);
    expect(body.subject).toBe("A customer asked for a person");
    expect(body.html).toContain("https://hellocrew.vercel.app/app/conversations?c=c1");
  });

  it("never breaks the chat when sending fails", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    expect(await notifyOwner(fakeAdmin(null), "t1", { kind: "test" })).toBe(false);
  });
});
