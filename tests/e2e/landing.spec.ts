import {
  test,
  expect,
  expectNoOverflow,
  expectTouchTargets,
  shot,
} from "./helpers";

test("the landing page leads with one dominant action", async ({ page }) => {
  await page.goto("/");

  // Exactly one filled primary in the first screenful: the hero's.
  const hero = page.locator(".hero");
  await expect(hero.locator(".button.dark")).toHaveCount(1);
  await expect(
    hero.getByRole("link", { name: "Open the practice studio" }),
  ).toBeVisible();
  // The header's version of the same action is the quieter outline style.
  await expect(page.locator(".marketing-header .button.outline")).toBeVisible();
  await expect(page.locator(".marketing-header .button.dark")).toHaveCount(0);

  // The quieter secondary is a jump link, not a second button.
  const secondary = hero.getByRole("link", { name: "See how it works" });
  await expect(secondary).toBeVisible();
  await expect(secondary).toHaveAttribute("href", "#how-it-works");

  await expectNoOverflow(page);
  await shot(page, "landing-desktop");
});

test("the primary action opens the practice demo", async ({ page }) => {
  await page.goto("/");
  await page
    .locator(".hero")
    .getByRole("link", { name: "Open the practice studio" })
    .click();
  await page.waitForURL("**/app");
  await expect(page.getByRole("heading", { name: "Needs you" })).toBeVisible();
});

test("the secondary action jumps to how it works", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "See how it works" }).click();
  await expect(page).toHaveURL(/#how-it-works$/);
  await expect(
    page.getByRole("heading", { name: /Five steps/ }),
  ).toBeInViewport();
});

test("practice and sign-in are presented as different places", async ({
  page,
}) => {
  await page.goto("/");

  const practice = page.locator(".choose-card").first();
  const account = page.locator(".choose-card.is-account");
  await expect(practice.getByRole("heading")).toHaveText("The practice studio");
  await expect(account.getByRole("heading")).toHaveText("Your own workspace");

  await expect(practice.getByRole("link")).toHaveAttribute("href", "/app");
  await expect(account.getByRole("link")).toHaveAttribute(
    "href",
    "/login?next=/app",
  );

  // Practice must never be described as already uploaded.
  await expect(practice).toContainText("stays in this browser");
});

test("the five steps are an ordered list in product order", async ({ page }) => {
  await page.goto("/");
  const steps = page.locator(".step-list > li");
  await expect(steps).toHaveCount(5);
  await expect(page.locator("ol.step-list")).toBeVisible();
  for (const [i, text] of [
    "Teach the crew what it may say",
    "Test it on made-up customers",
    "Connect the channels you use",
    "Approve anything that matters",
    "Switch to Live AI when it feels right",
  ].entries()) {
    await expect(steps.nth(i)).toContainText(text);
  }
});

test("the crew preview names each role in text", async ({ page }) => {
  await page.goto("/");
  const crew = page.locator(".crew-preview > li");
  await expect(crew).toHaveCount(3);
  await expect(crew.nth(0)).toContainText("Receptionist");
  await expect(crew.nth(1)).toContainText("Reputation manager");
  // Status is never colour-only: the planned card says so in words.
  await expect(crew.nth(2)).toContainText("Planned");
  // The characters themselves stay decorative.
  await expect(page.locator(".crew-preview .buddy[aria-hidden='true']")).toHaveCount(3);
});

test("the page has semantic landmarks and a working skip link", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("header nav[aria-label='Main']")).toBeVisible();
  await expect(page.locator("main#main-content")).toBeVisible();
  await expect(page.locator("footer")).toBeVisible();
  // One h1, and it is the visible headline.
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toContainText("A crew your customers");

  await page.evaluate(() => document.body.focus());
  await page.keyboard.press("Tab");
  const skip = page.locator(".skip-link");
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => document.activeElement?.id)).toBe(
    "main-content",
  );
});

test("keyboard users reach both destinations from the header", async ({
  page,
}) => {
  await page.goto("/");
  const header = page.locator(".marketing-header");
  await expect(header.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    "/login?next=/app",
  );
  await expect(
    header.getByRole("link", { name: "Open the practice studio" }),
  ).toHaveAttribute("href", "/app");
});

for (const width of [390, 360]) {
  test(`the landing page fits a ${width}px screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await expectNoOverflow(page);

    // The hero action still reads first; the preview art follows the copy.
    const actions = await page
      .locator(".hero-actions")
      .evaluate((el) => el.getBoundingClientRect().top);
    const art = await page
      .locator(".hero-art")
      .evaluate((el) => el.getBoundingClientRect().top);
    expect(actions, "actions come before the preview art").toBeLessThan(art);

    if (width === 390) await shot(page, "landing-mobile");
  });
}

test("tap targets on the landing page are at least 44px tall", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expectTouchTargets(page);

  // The skip link is hidden until focused, so check it in that state.
  await page.evaluate(() => document.body.focus());
  await page.keyboard.press("Tab");
  const box = await page.locator(".skip-link").boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test("motion is dropped when the visitor asks for less of it", async ({
  browser,
}) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/");
  const animated = await page.evaluate(() => {
    const bad: string[] = [];
    document.querySelectorAll("*").forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.animationName !== "none" && cs.animationDuration !== "0s")
        bad.push(el.className.toString().slice(0, 30));
      if (cs.transitionDuration !== "0s") bad.push(`transition:${el.className.toString().slice(0, 24)}`);
    });
    return bad;
  });
  expect(animated, "animation or transition still running").toEqual([]);
  await context.close();
});
