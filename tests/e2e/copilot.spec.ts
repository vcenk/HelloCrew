import { test, expect, openDashboard, shot } from "./helpers";

/**
 * The panel itself: that it is reachable everywhere, that it does not break
 * the page it sits beside, and that it behaves on a phone. What it can
 * actually change is covered by the unit and policy tests — those do not
 * need a browser, and this does not need a model.
 */

test("the Copilot opens from any dashboard page", async ({ page }) => {
  await openDashboard(page);

  const launcher = page.getByRole("button", { name: "Open Copilot" });
  await expect(launcher).toBeVisible();
  await expect(launcher).toHaveAttribute("aria-expanded", "false");

  await launcher.click();
  const panel = page.locator(".copilot");
  await expect(panel).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Ask the Copilot" })).toBeVisible();
  await shot(page, "copilot-desktop");
});

test("it says which part of the dashboard it is looking at", async ({ page }) => {
  // Route context is a hint the owner can see, so they know what "here" means.
  await openDashboard(page, "/app/knowledge");
  await page.getByRole("button", { name: "Open Copilot" }).click();
  await expect(page.locator(".copilot-chip")).toHaveText(/Knowledge/);

  await page.getByRole("link", { name: "Connections" }).first().click();
  await page.waitForURL("**/app/connections");
  await expect(page.locator(".copilot-chip")).toHaveText(/Connections/);
});

test("Escape closes it and the page underneath still works", async ({ page }) => {
  await openDashboard(page, "/app/knowledge");
  await page.getByRole("button", { name: "Open Copilot" }).click();
  await expect(page.locator(".copilot")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.locator(".copilot")).toBeHidden();
  // The page it sits beside is untouched by any of this.
  await expect(page.getByRole("heading", { name: "Knowledge" }).first()).toBeVisible();
});

test("a closed panel is out of reach of the keyboard", async ({ page }) => {
  // Hidden but focusable is worse than hidden: tabbing lands somewhere the
  // owner cannot see.
  await openDashboard(page);
  const panel = page.locator(".copilot");
  await expect(panel).toHaveAttribute("aria-hidden", "true");
  await expect(panel).toHaveAttribute("inert", /.*/);
});

test("on a phone it covers the page rather than squeezing it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDashboard(page);
  await page.getByRole("button", { name: "Open Copilot" }).click();
  await expect(page.locator(".copilot")).toBeVisible();

  // The thing a side panel on a phone gets wrong.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "no horizontal overflow").toBeLessThanOrEqual(0);
  await shot(page, "copilot-mobile");
});
