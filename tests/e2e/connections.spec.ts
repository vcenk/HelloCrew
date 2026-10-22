import { test, expect, expectNoOverflow, openDashboard, shot } from "./helpers";

// Connections is the one place every account the crew uses is connected.
const connectors = [
  "Facebook & Instagram",
  "WhatsApp",
  "Google Business Profile",
  "Website chat",
];

test("the Connections page lists every account the crew can use", async ({
  page,
}) => {
  await openDashboard(page, "/app/connections");
  await expect(
    page.getByRole("heading", { name: "Connections" }).first(),
  ).toBeVisible();

  for (const name of connectors) {
    await expect(
      page.locator(".connector strong", { hasText: name }).first(),
      `connector "${name}" is listed`,
    ).toBeVisible();
  }
  await shot(page, "connections-desktop");
});

test("Connections is reachable from the sidebar", async ({ page }) => {
  await openDashboard(page);
  await page
    .locator(".dash-sidebar")
    .getByRole("link", { name: "Connections", exact: true })
    .click();
  await page.waitForURL("**/app/connections");
  await expect(
    page.getByRole("heading", { name: "Connections" }).first(),
  ).toBeVisible();
});

test("the Connections page fits a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDashboard(page, "/app/connections");
  await expect(page.locator(".connector").first()).toBeVisible();
  await expectNoOverflow(page);
  await shot(page, "connections-mobile");
});
