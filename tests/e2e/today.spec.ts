import { test, expect, openDashboard, shot } from "./helpers";

test("Today shows what needs the owner and the current crew", async ({
  page,
}) => {
  await openDashboard(page);
  await expect(page.getByRole("heading", { name: "Needs you" })).toBeVisible();
  await expect(page.getByText("All clear", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your crew" })).toBeVisible();
  // Two hired (Receptionist, Reputation manager) plus the one still on offer.
  await expect(page.locator(".crew-tile")).toHaveCount(3);
  await expect(
    page.locator('.crew-tile[data-active="true"]'),
  ).toHaveCount(2);
  await expect(
    page.locator(".crew-tile", { hasText: "Reputation manager" }).first(),
  ).toBeVisible();
  await shot(page, "today-desktop");
});

// Links people may still have bookmarked from the old single-page dashboard.
const legacy: [string, string][] = [
  ["/app?section=assistant", "/app/crew/receptionist/personality"],
  ["/app?section=knowledge", "/app/knowledge"],
  ["/app?section=crew", "/app/crew"],
  ["/app?section=workflows", "/app/workflows"],
  ["/app?section=conversations", "/app/conversations"],
  // Channels moved to the Connections page, which now owns every account.
  ["/app?section=channels", "/app/connections"],
  ["/app?section=settings", "/app/settings"],
  ["/app/inbox", "/app/conversations"],
  ["/app/assistant", "/app/crew/receptionist/personality"],
  ["/app/channels", "/app/connections"],
];

for (const [from, to] of legacy) {
  test(`${from} still lands on ${to}`, async ({ page }) => {
    await page.goto(from);
    await page.waitForURL(`**${to}`);
    expect(new URL(page.url()).pathname).toBe(to);
  });
}

test("?section=home stays on Today", async ({ page }) => {
  await page.goto("/app?section=home");
  await expect(page.getByRole("heading", { name: "Needs you" })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/app");
});

test("the setup bar can show the whole checklist, not just the next step", async ({
  page,
}) => {
  await openDashboard(page);

  const toggle = page.getByRole("button", { name: /show all \d+ setup steps/i });
  await expect(toggle).toBeVisible();
  // Collapsed to begin with: the next step stays the loudest thing here.
  await expect(page.locator("#setup-steps")).toHaveCount(0);

  await toggle.click();
  const steps = page.locator("#setup-steps li");
  await expect(steps.first()).toBeVisible();

  // Every step the bar is counting is listed, done ones included — the point
  // is seeing what is left, which the bar alone never showed.
  const counted = Number(
    ((await page.locator(".setup-bar-count").innerText()).split("/")[1] ?? "0"),
  );
  expect(counted).toBeGreaterThan(0);
  await expect(steps).toHaveCount(counted);
  await expect(page.locator('#setup-steps li[data-done="true"]').first()).toBeVisible();

  await page.getByRole("button", { name: /hide the rest of setup/i }).click();
  await expect(page.locator("#setup-steps")).toHaveCount(0);
});
