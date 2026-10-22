import { test, expect, expectNoOverflow, nav, openDashboard, shot } from "./helpers";

// 390px is an iPhone 14/15; 360px is the narrowest Android still worth support.
const widths = [390, 360];

const pages: [string, string, string][] = [
  ["Today", "/app", "today-mobile"],
  ["Conversations", "/app/conversations", "conversations-mobile"],
  ["Crew", "/app/crew", "crew-mobile"],
  ["Knowledge", "/app/knowledge", "knowledge-mobile"],
  ["Connections", "/app/connections", "connections-mobile"],
];

for (const width of widths) {
  test(`dashboard pages fit a ${width}px screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    for (const [, path, name] of pages) {
      await openDashboard(page, path);
      await expectNoOverflow(page);
      if (width === 390) await shot(page, name);
    }

    await openDashboard(page, "/app/crew/receptionist");
    await expectNoOverflow(page);
    if (width === 390) await shot(page, "agent-mobile");

    await openDashboard(page, "/app/crew/reputation");
    await expectNoOverflow(page);
    if (width === 390) await shot(page, "reputation-mobile");

    await openDashboard(page, "/app/settings");
    await expectNoOverflow(page);
  });
}

test("the drawer navigates between pages on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDashboard(page);

  for (const [label, path] of pages.slice(1)) {
    await nav(page, label);
    await page.waitForURL(`**${path}`);
    await expectNoOverflow(page);
  }
});

test("topbar controls are at least 44px tall on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDashboard(page);

  const targets = [
    page.getByRole("button", { name: "Open menu", exact: true }),
    page.getByRole("button", { name: "Search", exact: true }),
    page.locator(".dash-theme button").first(),
    page.locator(".dash-save"),
  ];
  for (const target of targets) {
    const box = await target.boundingBox();
    expect(box, "control should be laid out").not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});
