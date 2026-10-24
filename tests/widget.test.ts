import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { POST as WIDGET_MESSAGE } from "../app/api/widget/message/route";
import { GET as WIDGET_LOADER } from "../app/widget.js/route";
import { modelProviders } from "../lib/model-policy";
import { respondToWidgetMessage } from "../lib/server/widget-provider";
import {
  DEMO_WIDGET_INSTALLATION_ID,
  getWidgetInstallation,
  widgetMessageRequestSchema,
} from "../lib/widget";
import { createWidgetLoaderScript } from "../lib/widget-loader";

function widgetRequest(body: unknown, origin = "http://localhost"): Request {
  return new Request("http://localhost/api/widget/message", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}

describe("website widget", () => {
  it("keeps one fixed public practice installation", () => {
    const installation = getWidgetInstallation(DEMO_WIDGET_INSTALLATION_ID);
    expect(installation).toMatchObject({
      id: DEMO_WIDGET_INSTALLATION_ID,
      mode: "practice",
      modelProvider: "practice",
    });
    expect(getWidgetInstallation("unknown-installation")).toBeNull();
  });

  it("validates the public request contract", () => {
    expect(
      widgetMessageRequestSchema.safeParse({
        installationId: DEMO_WIDGET_INSTALLATION_ID,
        message: "When are you open?",
      }).success,
    ).toBe(true);
    expect(
      widgetMessageRequestSchema.safeParse({
        installationId: "../../private",
        message: "Hello",
      }).success,
    ).toBe(false);
  });

  it("routes through the model-neutral practice provider", () => {
    const installation = getWidgetInstallation(DEMO_WIDGET_INSTALLATION_ID)!;
    expect(respondToWidgetMessage(installation, "When are you open?")).toEqual({
      reply: "Saved sample hours: Monday–Friday, 9am–5pm",
      source: "Business hours",
      engine: "practice",
    });
    expect(
      respondToWidgetMessage(installation, "Can you invent a discount?").reply,
    ).toContain("I’m not certain from the approved information");
  });

  it("serves a defensive iframe loader", async () => {
    const response = WIDGET_LOADER();
    expect(response.headers.get("content-type")).toContain(
      "application/javascript",
    );
    const loader = await response.text();
    expect(loader).toBe(createWidgetLoaderScript());
    expect(loader).toContain("encodeURIComponent(installation)");
    expect(loader).toContain("event.source !== frame.contentWindow");
    expect(loader).toContain("allow-forms allow-same-origin allow-scripts");
  });

  it("answers a valid same-origin widget message", async () => {
    const response = await WIDGET_MESSAGE(
      widgetRequest({
        installationId: DEMO_WIDGET_INSTALLATION_ID,
        message: "Is parking available?",
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      source: "Saved FAQ",
      engine: "practice",
    });
  });

  it("rejects cross-origin and unknown installations", async () => {
    expect(
      (
        await WIDGET_MESSAGE(
          widgetRequest(
            {
              installationId: DEMO_WIDGET_INSTALLATION_ID,
              message: "Hello",
            },
            "https://other.example",
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await WIDGET_MESSAGE(
          widgetRequest({
            installationId: "unknown-installation",
            message: "Hello",
          }),
        )
      ).status,
    ).toBe(404);
  });

  it("requires an explicit browser origin", async () => {
    const response = await WIDGET_MESSAGE(
      new Request("http://localhost/api/widget/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installationId: DEMO_WIDGET_INSTALLATION_ID,
          message: "Hello",
        }),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("enforces the actual widget request byte cap", async () => {
    const response = await WIDGET_MESSAGE(
      widgetRequest({
        installationId: DEMO_WIDGET_INSTALLATION_ID,
        message: "x".repeat(3000),
      }),
    );
    expect(response.status).toBe(413);
  });

  it("declares practice, OpenAI, and Anthropic provider slots", () => {
    expect(modelProviders.map((provider) => provider.id)).toEqual([
      "practice",
      "openai",
      "anthropic",
    ]);
    // Practice and OpenAI both run today; Anthropic is still a slot. This used
    // to assert exactly one active provider, which kept reporting OpenAI as
    // not connected long after Live AI started using it.
    const active = modelProviders.filter((p) => p.status === "active");
    expect(active.map((p) => p.id)).toEqual(["practice", "openai"]);
  });
});

describe("workspace website chat", () => {
  it("accepts only real website origins", async () => {
    const { normalizeOrigin } = await import("../lib/widget");
    expect(normalizeOrigin("mysalon.com")).toBe("https://mysalon.com");
    expect(normalizeOrigin("https://www.MySalon.com/book?x=1")).toBe("https://www.mysalon.com");
    expect(normalizeOrigin("http://localhost:5173")).toBe("http://localhost:5173");
    expect(normalizeOrigin("http://mysalon.com")).toBeNull();
    expect(normalizeOrigin("https://user:pw@mysalon.com")).toBeNull();
    expect(normalizeOrigin("javascript:alert(1)")).toBeNull();
    expect(normalizeOrigin("intranet")).toBeNull();
    expect(normalizeOrigin("")).toBeNull();
  });

  it("validates visitor chat requests", async () => {
    const { widgetChatRequestSchema } = await import("../lib/widget");
    const installationId = "w-abcdefghij0123456789";
    expect(widgetChatRequestSchema.safeParse({ installationId, message: "Hi" }).success).toBe(true);
    expect(
      widgetChatRequestSchema.safeParse({
        installationId,
        message: "Hi",
        conversation: { id: crypto.randomUUID(), token: "a".repeat(43) },
      }).success,
    ).toBe(true);
    expect(widgetChatRequestSchema.safeParse({ installationId: "demo-hellocrew", message: "Hi" }).success).toBe(false);
    expect(widgetChatRequestSchema.safeParse({ installationId, message: "x".repeat(1001) }).success).toBe(false);
    expect(
      widgetChatRequestSchema.safeParse({ installationId, message: "Hi", conversation: { id: "x", token: "y" } }).success,
    ).toBe(false);
  });

  it("refuses visitor messages without a configured installation", async () => {
    const { POST } = await import("../app/api/widget/chat/route");
    const response = await POST(
      new Request("http://localhost/api/widget/chat", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ installationId: "w-abcdefghij0123456789", message: "Hi" }),
      }),
    );
    expect(response.status).toBe(404);
  });
});
