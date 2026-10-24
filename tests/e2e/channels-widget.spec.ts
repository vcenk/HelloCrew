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

test("the widget header shows the receptionist Crewling", async ({ page }) => {
  await page.goto("/widget/demo-hellocrew");
  await page.getByRole("button", { name: "Open website chat", exact: true }).click();

  const avatar = page.locator('.crew-avatar[data-role="receptionist"]');
  await expect(avatar).toHaveCount(1);
  // Decorative: the agent's name is right beside it in text.
  await expect(avatar).toHaveAttribute("aria-hidden", "true");

  // The widget does not load dashboard.css, so its own stylesheet has to
  // colour the character — a bare shape would mean that regressed.
  const fill = await avatar
    .locator(".crew-avatar-shape")
    .evaluate((el) => getComputedStyle(el).fill);
  expect(fill).not.toBe("none");
  expect(fill).not.toBe("rgb(0, 0, 0)");

  // It leans while a reply is being written, then settles.
  await expect(avatar).toHaveAttribute("data-state", "idle");
  await page.getByRole("button", { name: "When are you open?", exact: true }).click();
  await expect(avatar).toHaveAttribute("data-state", "idle");
  await expect(page.getByText("Saved sample hours:", { exact: false })).toBeVisible();
});

test("the widget Crewling stops moving under reduced motion", async ({
  browser,
}) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/widget/demo-hellocrew");
  await page.getByRole("button", { name: "Open website chat", exact: true }).click();

  const running = await page.evaluate(
    () =>
      [...document.querySelectorAll(".crew-avatar *")].filter((el) => {
        const cs = getComputedStyle(el);
        return cs.animationName !== "none" && parseFloat(cs.animationDuration) > 0.01;
      }).length,
  );
  expect(running, "widget avatar animation should be stopped").toBe(0);
  await context.close();
});
