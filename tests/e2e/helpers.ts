import { test as base, expect, type Page } from "@playwright/test";

// Every spec fails if the page threw, which is what the old
// scripts/browser-check.mjs asserted once at the very end.
export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await use(errors);
      expect(errors, "uncaught page errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Dashboard navigation lives in a drawer on small screens. */
export async function nav(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "Open menu", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page
    .locator(".dash-sidebar")
    .getByRole("link", { name, exact: true })
    .first()
    .click();
}

/** Sends a message in the practice chat as the customer. */
export async function ask(page: Page, question: string) {
  await page
    .getByLabel("Message as a customer", { exact: true })
    .first()
    .fill(question);
  await page.getByRole("button", { name: "Send message", exact: true }).first().click();
}

/**
 * Every control a finger could actually hit must be at least 44px tall.
 * Skips controls that are visually hidden until focus (the skip link), which
 * are measured separately while focused.
 */
export async function expectTouchTargets(page: Page, min = 44) {
  const small = await page.evaluate((limit) => {
    const out: string[] = [];
    document.querySelectorAll("a, button").forEach((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      // A clipped control (the skip link until it is focused) is not something
      // a finger can hit, so it is measured separately in its focused state.
      if (rect.width === 0 || rect.height === 0 || style.clipPath !== "none")
        return;
      if (rect.height < limit)
        out.push(
          `${Math.round(rect.width)}x${Math.round(rect.height)} "${(el.textContent ?? "").trim().slice(0, 30)}"`,
        );
    });
    return out;
  }, min);
  expect(small, `controls shorter than ${min}px`).toEqual([]);
}

export async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    overflow.scrollWidth,
    `horizontal overflow on ${page.url()}`,
  ).toBeLessThanOrEqual(overflow.innerWidth);
}

/** Opens the dashboard and waits for the shell to finish hydrating. */
export async function openDashboard(page: Page, path = "/app") {
  await page.goto(path);
  await expect(page.locator(".dash-topbar")).toBeVisible();
  await expect(page.locator(".dash-skeleton")).toHaveCount(0);
}

/**
 * Teaches the receptionist one FAQ through the real Knowledge UI, so specs
 * that need an approved answer can set one up without depending on the order
 * tests happen to run in.
 */
export async function addFaq(page: Page, question: string, answer: string) {
  await openDashboard(page, "/app/knowledge");
  await page.getByRole("button", { name: "Add knowledge", exact: true }).click();
  await page.getByRole("radio", { name: "Write it" }).click();
  await page.getByLabel("Customer question").fill(question);
  await page.getByLabel("Answer", { exact: true }).fill(answer);
  await saveDialog(page, "#kdialog-title");
  await expect(page.getByText("Added to knowledge", { exact: true })).toBeVisible();
}

/** Clicks the Save button belonging to one dialog, not any other on the page. */
export async function saveDialog(page: Page, titleSelector: string) {
  await page
    .locator(titleSelector)
    .locator("..")
    .getByRole("button", { name: "Save", exact: true })
    .click();
}

/** Adds a staff member through the Team panel on the Knowledge page. */
export async function addTeamMember(page: Page, name: string, role: string) {
  await page
    .locator(".team-group")
    .getByRole("button", { name: "Add", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).last().fill(name);
  await page.getByLabel("Role", { exact: true }).fill(role);
  await saveDialog(page, "#team-dialog-title");
  await expect(
    page.getByText(`${name} added to the team`, { exact: true }),
  ).toBeVisible();
}

/**
 * Optional QA screenshots, kept so the manual review workflow that
 * scripts/browser-check.mjs supported still works: set SHOTS_DIR to collect
 * them. Playwright captures its own screenshots on failure regardless.
 */
export async function shot(page: Page, name: string) {
  const dir = process.env.SHOTS_DIR;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/hellocrew-${name}.png`, fullPage: true });
}
