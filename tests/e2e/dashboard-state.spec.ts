import { test, expect, openDashboard } from "./helpers";

test.describe("knowledge filter in the URL", () => {
  const addStaff = async (page: import("@playwright/test").Page, name: string) => {
    await page.locator(".team-group").getByRole("button", { name: "Add", exact: true }).click();
    await page.getByLabel("Name", { exact: true }).last().fill(name);
    await page.getByLabel("Role", { exact: true }).fill("Stylist");
    await page
      .locator("#team-dialog-title")
      .locator("..")
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(page.getByText(`${name} added to the team`, { exact: true })).toBeVisible();
  };

  test("picking a person is kept in the URL and survives a refresh", async ({
    page,
  }) => {
    await openDashboard(page, "/app/knowledge");
    await addStaff(page, "Ayşe");

    await page.locator(".staff-filter").getByRole("button", { name: "Ayşe", exact: true }).click();
    await expect(page).toHaveURL(/[?&]staff=/);

    await page.reload();
    // The chosen person is still selected after a reload.
    await expect(
      page.locator(".staff-filter").getByRole("button", { name: "Ayşe", exact: true }),
    ).toHaveAttribute("aria-pressed", /true/);
  });

  test("Back undoes the filter", async ({ page }) => {
    await openDashboard(page, "/app/knowledge");
    await addStaff(page, "Mert");

    await page.locator(".staff-filter").getByRole("button", { name: "Mert", exact: true }).click();
    await expect(page).toHaveURL(/[?&]staff=/);

    await page.goBack();
    await expect(page).not.toHaveURL(/[?&]staff=/);
  });
});

test.describe("connections setup in the URL", () => {
  test("an expanded connector is kept in the URL", async ({ page }) => {
    await openDashboard(page, "/app/connections?open=website");
    await expect(page).toHaveURL(/open=website/);
    // Reloading keeps it open rather than collapsing back.
    await page.reload();
    await expect(page).toHaveURL(/open=website/);
  });

  test("a transient OAuth result is dropped without taking the rest with it", async ({
    page,
  }) => {
    await page.goto("/app/connections?open=website&error=meta_denied");
    // The message is shown…
    await expect(page.locator(".dash-toast")).toBeVisible();
    // …then only the one-shot parameter goes.
    await expect(page).not.toHaveURL(/error=/);
    await expect(page).toHaveURL(/open=website/);
  });
});

test.describe("Today separates practice from real customers", () => {
  test("signed out, the panel is explicitly about test chats", async ({ page }) => {
    await openDashboard(page);
    await expect(
      page.getByRole("heading", { name: "Test chats so far" }),
    ).toBeVisible();
  });

  test("Needs you lists approvals before anything else", async ({ page }) => {
    await openDashboard(page, "/app/conversations");
    await page.getByRole("button", { name: "Book a visit", exact: true }).click();
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeVisible();

    await openDashboard(page);
    const first = page.locator(".needs-you .decision-list > li").first();
    await expect(first).toContainText("Approve a practice booking");
  });

  test("an unanswered question is listed, and above leads", async ({ page }) => {
    await openDashboard(page, "/app/conversations");
    await page.getByLabel("Message as a customer", { exact: true }).first().fill("Do you sell gift cards?");
    await page.getByRole("button", { name: "Send message", exact: true }).first().click();
    await expect(
      page.getByRole("link", { name: "Teach this answer", exact: true }).first(),
    ).toBeVisible();

    await openDashboard(page);
    await expect(page.locator(".needs-you")).toContainText("Do you sell gift cards?");
  });
});

test.describe("unsaved changes across editors", () => {
  test("the business profile is guarded too", async ({ page }) => {
    await openDashboard(page, "/app/knowledge");
    const name = page.locator("#k-name");
    await expect(name).toBeVisible();
    await name.fill("A Different Studio Name");

    await page.locator(".dash-sidebar").getByRole("link", { name: "Crew", exact: true }).click();
    const dialog = page.locator(".ui-confirm");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Discard changes?");

    await page.getByRole("button", { name: "Keep editing" }).click();
    expect(new URL(page.url()).pathname).toContain("/app/knowledge");
    await expect(name).toHaveValue("A Different Studio Name");
  });

  test("saving the profile releases the guard", async ({ page }) => {
    await openDashboard(page, "/app/knowledge");
    await page.locator("#k-name").fill("Saved Studio");
    await page.getByRole("button", { name: "Save profile", exact: true }).click();

    await page.locator(".dash-sidebar").getByRole("link", { name: "Crew", exact: true }).click();
    await page.waitForURL("**/app/crew");
    await expect(page.locator(".ui-confirm")).toBeHidden();
  });
});
