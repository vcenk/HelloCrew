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
