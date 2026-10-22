import { test, expect, openDashboard } from "./helpers";

const activeElement = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return { label: "none", inSidebar: false };
    return {
      label: el.getAttribute("aria-label") ?? el.textContent?.trim() ?? el.tagName,
      inSidebar: !!el.closest(".dash-sidebar"),
    };
  });

test.describe("mobile navigation drawer", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openDashboard(page);
  });

  test("the closed drawer is out of the tab order", async ({ page }) => {
    await expect(page.locator(".dash-sidebar")).toHaveAttribute("inert", "");

    // Tabbing from the top must never land on an off-canvas control.
    await page.evaluate(() => document.body.focus());
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      const { inSidebar } = await activeElement(page);
      expect(inSidebar, `Tab stop ${i + 1} is inside the closed drawer`).toBe(
        false,
      );
    }
  });

  test("opening moves focus in and Escape puts it back", async ({ page }) => {
    const trigger = page.getByRole("button", { name: "Open menu", exact: true });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.click();

    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(await activeElement(page)).toMatchObject({
      label: "Close menu",
      inSidebar: true,
    });

    // The page behind the drawer is inert, so Tab stays in the drawer.
    await expect(page.locator(".dash-main")).toHaveAttribute("inert", "");
    await expect(page.locator(".dash-sidebar")).not.toHaveAttribute("inert", "");
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Tab");
      expect((await activeElement(page)).inSidebar).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(page.locator(".dash-sidebar")).toHaveAttribute("data-open", "false");
    expect((await activeElement(page)).label).toBe("Open menu");
    await expect(page.locator(".dash-main")).not.toHaveAttribute("inert", "");
  });

  test("the close button also returns focus to the trigger", async ({ page }) => {
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await page
      .locator(".dash-sidebar")
      .getByRole("button", { name: "Close menu", exact: true })
      .click();
    expect((await activeElement(page)).label).toBe("Open menu");
  });

  test("following a link closes the drawer without stealing focus back", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await page
      .locator(".dash-sidebar")
      .getByRole("link", { name: "Knowledge", exact: true })
      .click();
    await page.waitForURL("**/app/knowledge");
    await expect(page.locator(".dash-sidebar")).toHaveAttribute("data-open", "false");
    expect((await activeElement(page)).label).not.toBe("Open menu");
  });
});

test("the sidebar is never inert on a desktop viewport", async ({ page }) => {
  await openDashboard(page);
  await expect(page.locator(".dash-sidebar")).not.toHaveAttribute("inert", "");
  await expect(
    page.locator(".dash-sidebar").getByRole("link", { name: "Today", exact: true }),
  ).toBeVisible();
});

test.describe("command menu", () => {
  test.beforeEach(async ({ page }) => {
    await openDashboard(page);
  });

  const open = async (page: import("@playwright/test").Page) => {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.locator(".dash-command")).toHaveAttribute("open", "");
    await expect(page.locator(".dash-command-input input")).toBeFocused();
  };

  test("Ctrl+K opens it with the input focused, every time", async ({ page }) => {
    // Reopening right after a native close must not be swallowed by a toggle
    // that is still reading stale state.
    for (let i = 0; i < 3; i++) {
      await open(page);
      await page.keyboard.press("Escape");
      await expect(page.locator(".dash-command")).not.toHaveAttribute("open", "");
    }
  });

  test("Ctrl+K also closes it again", async ({ page }) => {
    await open(page);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.locator(".dash-command")).not.toHaveAttribute("open", "");
  });

  test("Escape returns focus to the button that opened it", async ({ page }) => {
    await page.locator(".dash-search").click();
    await expect(page.locator(".dash-command-input input")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator(".dash-search")).toBeFocused();
  });

  test("the highlighted option is announced and stays in view", async ({
    page,
  }) => {
    await open(page);
    const input = page.locator(".dash-command-input input");
    await expect(input).toHaveAttribute("role", "combobox");
    await expect(input).toHaveAttribute("aria-expanded", "true");
    await expect(input).toHaveAttribute("aria-controls", "dash-command-options");

    const count = await page.locator(".dash-command-list li").count();
    expect(count).toBeGreaterThan(8);

    // aria-activedescendant must always name the highlighted option, and the
    // list scrolls far enough to show it.
    for (let i = 0; i < count; i++) {
      const selected = page.locator('.dash-command-list li[aria-selected="true"]');
      await expect(selected).toHaveCount(1);
      const id = await selected.getAttribute("id");
      await expect(input).toHaveAttribute("aria-activedescendant", id!);
      expect(
        await page.evaluate(() => {
          const li = document.querySelector(
            '.dash-command-list li[aria-selected="true"]',
          )!;
          const ul = document.querySelector(".dash-command-list")!;
          const a = li.getBoundingClientRect();
          const c = ul.getBoundingClientRect();
          return a.top >= c.top - 1 && a.bottom <= c.bottom + 1;
        }),
        "highlighted option is scrolled into view",
      ).toBe(true);
      await page.keyboard.press("ArrowDown");
    }
  });

  test("options are not separately focusable", async ({ page }) => {
    await open(page);
    // role=option must not wrap a focusable control, or Tab walks the list and
    // desyncs from the arrow-key highlight.
    expect(
      await page.locator('.dash-command-list li[role="option"] button').count(),
    ).toBe(0);
    expect(
      await page.locator('.dash-command-list li[role="option"][tabindex]').count(),
    ).toBe(0);
  });

  test("arrow keys wrap around the list", async ({ page }) => {
    await open(page);
    const selected = page.locator('.dash-command-list li[aria-selected="true"]');
    await expect(selected).toContainText("Go to Today");
    await page.keyboard.press("ArrowUp");
    await expect(selected).toContainText("Match system theme");
    await page.keyboard.press("ArrowDown");
    await expect(selected).toContainText("Go to Today");
  });

  test("narrowing the query never leaves the highlight out of range", async ({
    page,
  }) => {
    await open(page);
    for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowDown");
    await page.keyboard.type("knowl");

    const selected = page.locator('.dash-command-list li[aria-selected="true"]');
    await expect(selected).toHaveCount(1);
    await expect(selected).toContainText("Go to Knowledge");

    // Enter acts on the visible highlight rather than doing nothing.
    await page.keyboard.press("Enter");
    await page.waitForURL("**/app/knowledge");
  });

  test("no match shows a message and Enter is harmless", async ({ page }) => {
    await open(page);
    await page.keyboard.type("zzzzzz");
    await expect(page.locator(".dash-command-empty")).toBeVisible();
    await expect(page.locator(".dash-command-input input")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(
      await page
        .locator(".dash-command-input input")
        .getAttribute("aria-activedescendant"),
    ).toBeNull();

    await page.keyboard.press("Enter");
    await expect(page.locator(".dash-command-empty")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/app");
  });

  test("clicking an option runs it", async ({ page }) => {
    await open(page);
    await page.locator(".dash-command-list li", { hasText: "Go to Crew" }).click();
    await page.waitForURL("**/app/crew");
  });

  test("it can start a fresh test conversation", async ({ page }) => {
    await open(page);
    await page.keyboard.type("new test");
    await page.keyboard.press("Enter");
    await page.waitForURL("**/app/conversations");
    await expect(
      page.getByText("New test conversation started", { exact: true }),
    ).toBeVisible();
  });
});

test("the skip link jumps to the main content", async ({ page }) => {
  await openDashboard(page);
  await page.evaluate(() => document.body.focus());
  await page.keyboard.press("Tab");
  await expect(page.locator(".dash-skip")).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("dash-main");
});
