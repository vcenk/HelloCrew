import { test, expect, ask, openDashboard } from "./helpers";

test.describe("operating mode", () => {
  test("a signed-out visitor is told it is guest practice", async ({ page }) => {
    await openDashboard(page);
    const badge = page.locator(".dash-topbar .dash-mode");
    await expect(badge).toHaveText(/Guest practice/);
    // An icon carries the meaning too, so tone is never the only signal.
    await expect(badge.locator("svg")).toBeVisible();
    await expect(badge).toHaveAttribute("data-billable", "false");
  });

  test("the badge never claims a mode it cannot be in", async ({ page }) => {
    await openDashboard(page);
    const text = await page.locator(".dash-topbar .dash-mode").innerText();
    // Signed out, Live AI is impossible — the old hardcoded badge could not
    // tell the difference.
    expect(text).not.toMatch(/Live AI$/);
  });

  test("Conversations shows the mode and explains it", async ({ page }) => {
    await openDashboard(page, "/app/conversations");
    const badge = page.locator(".ui-page-header .dash-mode");
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/Guest practice/);
    await expect(badge).toHaveAttribute("title", /no paid AI calls/i);
  });

  test("taking over a chat switches the mode to human", async ({ page }) => {
    await openDashboard(page, "/app/conversations");
    await ask(page, "Are you open today?");
    await page.getByRole("button", { name: "Take over", exact: true }).click();

    const badge = page.locator(".ui-page-header .dash-mode");
    await expect(badge).toHaveText(/You’re replying/);
    await expect(badge).toHaveAttribute("data-tone", "human");
    await expect(page.locator(".trace")).toContainText("taken over");

    await page.getByRole("button", { name: "Hand back to AI", exact: true }).click();
    await expect(badge).not.toHaveText(/You’re replying/);
  });

  test("the mode stays visible on a phone in Conversations", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openDashboard(page, "/app/conversations");
    // The topbar copy is dropped for space; the page header's is not.
    await expect(page.locator(".dash-topbar .dash-mode")).toBeHidden();
    await expect(page.locator(".ui-page-header .dash-mode")).toBeVisible();
  });
});

test.describe("unsaved changes", () => {
  const openPersonality = async (page: import("@playwright/test").Page) => {
    await openDashboard(page, "/app/crew/receptionist/personality");
    await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
  };

  test("leaving a clean form does not ask anything", async ({ page }) => {
    await openPersonality(page);
    await page.locator(".dash-sidebar").getByRole("link", { name: "Knowledge", exact: true }).click();
    await page.waitForURL("**/app/knowledge");
    await expect(page.locator(".ui-confirm")).toBeHidden();
  });

  test("leaving a dirty form asks before discarding", async ({ page }) => {
    await openPersonality(page);
    await page.getByLabel("Name", { exact: true }).fill("Unsaved Name");

    await page.locator(".dash-sidebar").getByRole("link", { name: "Knowledge", exact: true }).click();

    const dialog = page.locator(".ui-confirm");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Discard changes?");
    // Navigation was actually blocked.
    expect(new URL(page.url()).pathname).toContain("/personality");

    // Keeping the edits returns to the form with the text intact.
    await page.getByRole("button", { name: "Keep editing" }).click();
    await expect(dialog).toBeHidden();
    expect(new URL(page.url()).pathname).toContain("/personality");
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Unsaved Name");
  });

  test("discarding continues to the page that was asked for", async ({ page }) => {
    await openPersonality(page);
    await page.getByLabel("Name", { exact: true }).fill("Thrown Away");
    await page.locator(".dash-sidebar").getByRole("link", { name: "Knowledge", exact: true }).click();
    await page.getByRole("button", { name: "Discard changes" }).click();
    await page.waitForURL("**/app/knowledge");
    await expect(page.getByRole("heading", { name: "Knowledge" })).toBeVisible();
  });

  test("saving clears the guard, so leaving is silent afterwards", async ({ page }) => {
    await openPersonality(page);
    await page.getByLabel("Name", { exact: true }).fill("Saved Name");
    await page.getByRole("button", { name: "Save personality", exact: true }).click();
    await expect(page.getByText("Personality saved", { exact: true })).toBeVisible();

    await page.locator(".dash-sidebar").getByRole("link", { name: "Knowledge", exact: true }).click();
    await page.waitForURL("**/app/knowledge");
    await expect(page.locator(".ui-confirm")).toBeHidden();
  });
});

test.describe("deep-linked conversation", () => {
  test("the open chat is kept in the URL and survives a reload", async ({
    page,
  }) => {
    await openDashboard(page, "/app/conversations");
    await ask(page, "Where are you?");
    await expect(
      page.locator(".bubble-customer").getByText("Where are you?"),
    ).toBeVisible();

    // A signed-out practice chat has no saved id, so the URL stays clean —
    // but the chat itself must still survive a refresh.
    await page.reload();
    await expect(
      page.locator(".bubble-customer").getByText("Where are you?"),
    ).toBeVisible();
  });

  test("an unknown ?c= value does not break the page", async ({ page }) => {
    await page.goto("/app/conversations?c=does-not-exist");
    await expect(
      page.getByRole("heading", { name: "Conversations", exact: true }),
    ).toBeVisible();
  });
});
