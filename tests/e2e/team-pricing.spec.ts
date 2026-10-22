import {
  test,
  expect,
  addTeamMember,
  ask,
  nav,
  openDashboard,
  saveDialog,
  shot,
} from "./helpers";

test("prices per staff member show a range and filter by person", async ({
  page,
}) => {
  await openDashboard(page, "/app/knowledge");
  await addTeamMember(page, "Ayşe", "Senior stylist");
  await addTeamMember(page, "Mert", "Junior stylist");

  await page
    .locator(".kgroup")
    .filter({ hasText: "Services & prices" })
    .getByRole("button", { name: "Add", exact: true })
    .click();
  await page.getByLabel("Service", { exact: true }).fill("Haircut");
  await page.getByText("Depends on who or which option").click();

  await page
    .getByLabel("Option 1: who or what")
    .selectOption({ label: "Ayşe · Senior stylist" });
  await page.getByLabel("Option 1 price").fill("$60");
  await page.getByLabel("Option 1 time").fill("45 min");
  await page.getByRole("button", { name: "Add a price", exact: true }).click();
  await page
    .getByLabel("Option 2: who or what")
    .selectOption({ label: "Mert · Junior stylist" });
  await page.getByLabel("Option 2 price").fill("$40");
  await saveDialog(page, "#kdialog-title");

  await expect(page.getByText("Added to knowledge", { exact: true })).toBeVisible();
  await expect(page.getByText("$40–$60", { exact: true })).toBeVisible();
  await expect(page.getByText("Ayşe $60", { exact: true })).toBeVisible();

  // Filtering to one person hides groups that are not about them.
  await page
    .locator(".staff-filter")
    .getByRole("button", { name: "Mert", exact: true })
    .click();
  await expect(
    page.locator(".kgroup").filter({ hasText: "Opening hours" }),
  ).toHaveCount(0);
  await expect(page.getByText("Mert $40", { exact: true })).toBeVisible();

  await page
    .locator(".staff-filter")
    .getByRole("button", { name: "Everyone", exact: true })
    .click();
  await expect(
    page.locator(".kgroup").filter({ hasText: "Opening hours" }),
  ).toHaveCount(1);
  await shot(page, "knowledge-team-desktop");

  // The receptionist quotes the range it just learned.
  await nav(page, "Conversations");
  await ask(page, "How much is a haircut?");
  await expect(page.getByText("Haircut: $40–$60").first()).toBeVisible();
});
