import { test, expect, nav, openDashboard, shot } from "./helpers";

test("settings exposes the live AI controls", async ({ page }) => {
  await openDashboard(page, "/app/settings");
  await expect(page.getByRole("heading", { name: "Live AI" })).toBeVisible();
});

test("the dark theme sticks while moving between pages", async ({ page }) => {
  await openDashboard(page, "/app/settings");
  await page.locator(".dash-theme").getByRole("radio", { name: "Dark" }).click();

  await nav(page, "Today");
  await expect(page.locator('.dash[data-theme="dark"]')).toBeVisible();
  await shot(page, "today-dark");

  await nav(page, "Crew");
  await expect(page.locator('.dash[data-theme="dark"]')).toBeVisible();
  await page.locator(".agent-card").first().click();
  await page.waitForURL("**/app/crew/receptionist");
  await expect(page.locator('.dash[data-theme="dark"]')).toBeVisible();
  await shot(page, "agent-dark");

  // And it survives a reload, because the choice is stored.
  await page.reload();
  await expect(page.locator('.dash[data-theme="dark"]')).toBeVisible();

  await page.locator(".dash-theme").getByRole("radio", { name: "Light" }).click();
  await expect(page.locator('.dash[data-theme="light"]')).toBeVisible();
});
