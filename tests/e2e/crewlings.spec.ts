import { test, expect, openDashboard } from "./helpers";

const bodyPath = (role: string) =>
  `.crew-avatar[data-role="${role}"] .crew-avatar-shape`;

test("Today's crew tiles use role-specific Crewlings", async ({ page }) => {
  await openDashboard(page);
  await expect(page.locator(`.crew-tile ${bodyPath("receptionist")}`)).toHaveCount(1);
  await expect(page.locator(`.crew-tile ${bodyPath("reputation")}`)).toHaveCount(1);

  // Every tile still names its role in text, so the art is never the only cue.
  await expect(
    page.locator(".crew-tile", { hasText: "Reputation manager" }).first(),
  ).toBeVisible();
});

test("crew cards and the sidebar badge carry Crewlings", async ({ page }) => {
  await openDashboard(page, "/app/crew");
  await expect(page.locator(`.agent-card ${bodyPath("receptionist")}`)).toHaveCount(1);
  await expect(page.locator(`.agent-card ${bodyPath("reputation")}`)).toHaveCount(1);
  await expect(page.locator(`.dash-mini-badge .crew-avatar`)).toHaveCount(1);
});

test("roles are told apart by silhouette, not only colour", async ({ page }) => {
  await openDashboard(page, "/app/crew");
  const shapes = await page.evaluate(() => {
    const byRole = new Map<string, string>();
    document.querySelectorAll(".crew-avatar").forEach((el) => {
      const role = el.getAttribute("data-role") ?? "";
      const d = el.querySelector(".crew-avatar-shape")?.getAttribute("d") ?? "";
      byRole.set(role, d);
    });
    return [...byRole.entries()];
  });
  expect(shapes.length).toBeGreaterThan(1);
  // No two roles may share a body path.
  const paths = shapes.map(([, d]) => d);
  expect(new Set(paths).size).toBe(paths.length);
});

test("decorative Crewlings are hidden from assistive tech", async ({ page }) => {
  await openDashboard(page, "/app/crew");
  const unlabelled = await page.evaluate(
    () =>
      [...document.querySelectorAll(".crew-avatar")].filter(
        (el) =>
          !el.getAttribute("aria-label") &&
          el.getAttribute("aria-hidden") !== "true",
      ).length,
  );
  expect(unlabelled, "unnamed avatars must be aria-hidden").toBe(0);
});

test("Crewlings render in the dark theme too", async ({ page }) => {
  await openDashboard(page, "/app/settings");
  await page.locator(".dash-theme").getByRole("radio", { name: "Dark" }).click();
  await page.locator(".dash-sidebar").getByRole("link", { name: "Crew", exact: true }).click();
  await page.waitForURL("**/app/crew");
  await expect(page.locator('.dash[data-theme="dark"]')).toBeVisible();

  const fill = await page
    .locator(`${bodyPath("receptionist")}`)
    .first()
    .evaluate((el) => getComputedStyle(el).fill);
  expect(fill).not.toBe("none");
  expect(fill).not.toBe("rgba(0, 0, 0, 0)");

  await page.locator(".dash-theme").getByRole("radio", { name: "Light" }).click();
});

test("Crewling motion stops when the visitor asks for less", async ({
  browser,
}) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await openDashboard(page, "/app/crew");
  const running = await page.evaluate(
    () =>
      [...document.querySelectorAll(".crew-avatar *")].filter((el) => {
        const cs = getComputedStyle(el);
        return (
          cs.animationName !== "none" &&
          parseFloat(cs.animationDuration) > 0.01
        );
      }).length,
  );
  expect(running, "avatar animation should be stopped").toBe(0);
  await context.close();
});

test("the crew pages have no horizontal overflow on a phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/app", "/app/crew", "/app/conversations"]) {
    await openDashboard(page, path);
    const [sw, iw] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      window.innerWidth,
    ]);
    expect(sw, `overflow on ${path}`).toBeLessThanOrEqual(iw);
  }
});
