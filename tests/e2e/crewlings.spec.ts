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

test("the chat Crewling works while a reply is being composed", async ({
  page,
}) => {
  await openDashboard(page, "/app/conversations");
  const avatar = page.locator(".thread-head .crew-avatar");
  await expect(avatar).toHaveAttribute("data-state", "idle");

  // A practice reply can land in a few milliseconds, so record the states the
  // avatar passes through rather than trying to catch "working" mid-flight.
  await page.evaluate(() => {
    const el = document.querySelector(".thread-head .crew-avatar")!;
    const seen: string[] = [el.getAttribute("data-state") ?? ""];
    (window as unknown as { __states: string[] }).__states = seen;
    new MutationObserver(() => {
      const next = el.getAttribute("data-state") ?? "";
      if (next !== seen[seen.length - 1]) seen.push(next);
    }).observe(el, { attributes: true, attributeFilter: ["data-state"] });
  });

  await page
    .getByLabel("Message as a customer", { exact: true })
    .first()
    .fill("When are you open?");
  await page.getByRole("button", { name: "Send message", exact: true }).first().click();

  await expect(page.locator(".bubble-assistant").last()).toBeVisible();
  await expect(avatar).toHaveAttribute("data-state", "idle");

  const states = await page.evaluate(
    () => (window as unknown as { __states: string[] }).__states,
  );
  expect(states, "avatar should pass through working").toContain("working");
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
