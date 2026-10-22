import { test, expect, openDashboard, shot } from "./helpers";

test("the crew page lists the hired agents and the ones you can add", async ({
  page,
}) => {
  await openDashboard(page, "/app/crew");
  await expect(page.getByText("Add to your crew", { exact: true })).toBeVisible();
  await expect(page.locator(".agent-card")).toHaveCount(2);
  await expect(page.locator(".hire-card")).toHaveCount(1);
  await shot(page, "crew-desktop");

  await page.locator(".agent-card").first().click();
  await page.waitForURL("**/app/crew/receptionist");
});

test("the Reputation manager has its own page", async ({ page }) => {
  await openDashboard(page, "/app/crew");
  await page
    .locator(".agent-card", { hasText: "Reputation manager" })
    .click();
  await page.waitForURL("**/app/crew/reputation");
  await expect(
    page.getByRole("heading", { name: "Reputation manager" }).first(),
  ).toBeVisible();
  await shot(page, "reputation-desktop");

  await page.goBack();
  await page.waitForURL("**/app/crew");
  await expect(page.locator(".agent-card")).toHaveCount(2);
});

test("turning a skill off changes what the receptionist will do", async ({
  page,
}) => {
  await openDashboard(page, "/app/crew/receptionist");
  await page
    .getByRole("radiogroup", { name: "Booking requests mode" })
    .getByRole("radio", { name: "Off" })
    .click();
  await expect(
    page.getByText("Booking requests: Off", { exact: true }),
  ).toBeVisible();

  await page
    .locator(".agent-try")
    .getByRole("button", { name: "Book a visit", exact: true })
    .click();
  await expect(
    page.locator(".agent-try").getByText("I can’t take bookings here."),
  ).toBeVisible();
  await shot(page, "agent-skills-desktop");

  await page
    .getByRole("radiogroup", { name: "Booking requests mode" })
    .getByRole("radio", { name: "Ask me first" })
    .click();
  await expect(
    page.getByText("Booking requests: Ask me first", { exact: true }),
  ).toBeVisible();
});

test("renaming the receptionist renames it across the dashboard", async ({
  page,
}) => {
  await openDashboard(page, "/app/crew/receptionist");
  await page.getByRole("tab", { name: "Personality" }).click();
  await page.waitForURL("**/personality");

  await page.getByLabel("Name", { exact: true }).fill("Mila");
  await page
    .getByRole("button", { name: "Save personality", exact: true })
    .click();
  await expect(page.getByText("Personality saved", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Mila", exact: true }),
  ).toBeVisible();
  await shot(page, "agent-personality-desktop");

  // The sidebar badge uses the same identity.
  await expect(page.locator(".dash-mini-badge")).toContainText("Mila");
});

test("the advanced workflow editor stays reachable from Skills", async ({
  page,
}) => {
  await openDashboard(page, "/app/crew/receptionist");
  await page.getByRole("tab", { name: "Skills" }).click();
  await page.getByRole("link", { name: /Advanced workflow editor/ }).click();
  await page.waitForURL("**/app/workflows");
  await expect(
    page.getByRole("heading", { name: "Workflow editor" }),
  ).toBeVisible();
});
