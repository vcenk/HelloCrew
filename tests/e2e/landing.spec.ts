import { test, expect, expectNoOverflow, shot } from "./helpers";

test("the landing page renders and leads into the practice demo", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Try the practice demo", exact: true }),
  ).toBeVisible();
  await expectNoOverflow(page);
  await shot(page, "landing-desktop");

  await page
    .getByRole("link", { name: "Try the practice demo", exact: true })
    .click();
  await page.waitForURL("**/app");
  await expect(page.getByRole("heading", { name: "Needs you" })).toBeVisible();
});

test("the landing page fits a phone screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Try the practice demo", exact: true }),
  ).toBeVisible();
  await expectNoOverflow(page);
  await shot(page, "landing-mobile");
});

test("signed-out visitors are sent from the workspace to sign in", async ({
  page,
}) => {
  // Needs the Supabase env vars; set SKIP_AUTH_CHECK=1 to skip locally.
  test.skip(
    process.env.SKIP_AUTH_CHECK === "1",
    "SKIP_AUTH_CHECK=1 — no Supabase credentials configured",
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/workspace");
  await page.waitForURL("**/login");
  await expect(
    page.getByRole("button", { name: "Continue with Google", exact: true }),
  ).toBeVisible();
  await shot(page, "login-desktop");
});
