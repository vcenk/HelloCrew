import { test, expect, openDashboard, shot } from "./helpers";

test("the website chat frame may be embedded by any site", async ({
  request,
  baseURL,
}) => {
  const response = await request.get(`${baseURL}/widget/demo-hellocrew`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-security-policy"]).toMatch(
    /frame-ancestors \*/,
  );
  expect(response.headers()["cache-control"]).toContain("no-store");
});

test("the installed widget answers on the test website", async ({ page }) => {
  await openDashboard(page, "/app/crew/receptionist/channels");
  await expect(page.getByText("Website chat", { exact: true })).toBeVisible();

  const popup = page.waitForEvent("popup");
  await page
    .getByRole("link", { name: "Open test website", exact: true })
    .click();
  const site = await popup;
  const errors: string[] = [];
  site.on("pageerror", (error) => errors.push(error.message));
  await site.waitForLoadState("networkidle");

  const widget = site.frameLocator('iframe[title="Chat with this business"]');
  await widget
    .getByRole("button", { name: "Open website chat", exact: true })
    .click();
  await widget
    .getByRole("button", { name: "When are you open?", exact: true })
    .click();
  await expect(widget.getByText("Saved sample hours:")).toBeVisible();

  expect(errors, "uncaught errors on the test website").toEqual([]);
  await site.close();
  await shot(page, "agent-channels-desktop");
});
