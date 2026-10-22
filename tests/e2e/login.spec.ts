import {
  test,
  expect,
  expectNoOverflow,
  expectTouchTargets,
  shot,
} from "./helpers";

// The sign-in page needs the Supabase env vars to render at all.
test.skip(
  process.env.SKIP_AUTH_CHECK === "1",
  "SKIP_AUTH_CHECK=1 — no Supabase credentials configured",
);

test("signed-out visitors are sent from the workspace to sign in", async ({
  page,
}) => {
  await page.goto("/workspace");
  await page.waitForURL("**/login");
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
});

test("the sign-in page explains what an account is for", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Somewhere permanent",
  );

  // The four reasons the task calls for, each named in text.
  const reasons = page.locator(".auth-reasons > li");
  await expect(reasons).toHaveCount(4);
  await expect(reasons.nth(0)).toContainText("Kept in your workspace");
  await expect(reasons.nth(1)).toContainText("On any device");
  await expect(reasons.nth(2)).toContainText("Real channels");
  await expect(reasons.nth(3)).toContainText("Live AI");

  await expectNoOverflow(page);
  await shot(page, "login-desktop");
});

test("it is clear that practice stays in the browser", async ({ page }) => {
  await page.goto("/login");
  const practice = page.locator(".auth-practice");
  // Must not imply the guest setup was already uploaded.
  await expect(practice).toContainText("has left your browser yet");
  await expect(
    practice.getByRole("link", { name: /Back to the practice studio/ }),
  ).toHaveAttribute("href", "/app");
});

test("the back link returns to the practice studio", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: /Back to the practice studio/ }).click();
  await page.waitForURL("**/app");
  await expect(page.getByRole("heading", { name: "Needs you" })).toBeVisible();
});

test("the brand returns to the marketing page", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "HelloCrew home" }).click();
  await page.waitForURL(/\/$/);
  await expect(page.locator("h1")).toContainText("A crew your customers");
});

test.describe("safe next destination", () => {
  test("a safe relative path is carried into the form", async ({ page }) => {
    await page.goto("/login?next=/app/knowledge");
    await expect(page.locator('form input[name="next"]')).toHaveValue(
      "/app/knowledge",
    );
  });

  for (const hostile of [
    "https://evil.example.com/",
    "//evil.example.com",
    "javascript:alert(1)",
  ]) {
    test(`"${hostile}" is rejected`, async ({ page }) => {
      await page.goto(`/login?next=${encodeURIComponent(hostile)}`);
      const value = await page
        .locator('form input[name="next"]')
        .inputValue();
      expect(value.startsWith("/"), `"${value}" must be a relative path`).toBe(
        true,
      );
      expect(value).not.toContain("evil.example.com");
    });
  }
});

test.describe("OAuth errors", () => {
  const cases: [string, string][] = [
    ["missing_code", "Google didn’t finish that sign-in"],
    ["callback_failed", "We couldn’t finish that sign-in"],
    ["provider_failed", "Google sign-in isn’t working right now"],
    ["oauth_start_failed", "Google sign-in couldn’t start"],
  ];

  for (const [code, text] of cases) {
    test(`${code} is explained in plain words`, async ({ page }) => {
      await page.goto(`/login?error=${code}`);
      const alert = page.locator(".auth-error");
      await expect(alert).toHaveAttribute("role", "alert");
      await expect(alert).toContainText(text);
      // An icon carries the meaning too, so it is not colour-only.
      await expect(alert.locator("svg")).toBeVisible();
    });
  }

  test("an unrecognised error still says something useful", async ({ page }) => {
    await page.goto("/login?error=something_unexpected");
    await expect(page.locator(".auth-error")).toContainText(
      "Something interrupted that sign-in",
    );
  });

  test("no internal detail leaks into the page", async ({ page }) => {
    await page.goto("/login?error=provider_failed");
    const body = (await page.locator("body").innerText()).toLowerCase();
    for (const leak of [
      "supabase",
      "client secret",
      "env",
      "stack",
      "undefined",
    ]) {
      expect(body, `"${leak}" should not be shown`).not.toContain(leak);
    }
  });

  test("the error does not survive a clean reload", async ({ page }) => {
    await page.goto("/login?error=callback_failed");
    await expect(page.locator(".auth-error")).toBeVisible();
    await page.goto("/login");
    await expect(page.locator(".auth-error")).toHaveCount(0);
  });
});

test("the submit button announces progress and refuses a second press", async ({
  page,
}) => {
  // Leave the server action's POST hanging, so useFormStatus stays pending
  // for the whole assertion block instead of racing the redirect to Google.
  await page.route("**/login", async (route) => {
    if (route.request().method() === "POST") {
      await new Promise(() => {});
      return;
    }
    await route.continue();
  });

  await page.goto("/login");
  // Located by class, not by name: the label becomes "Opening Google…" while
  // the request is in flight.
  const button = page.locator("button.auth-submit");
  const status = page.locator(".auth-status");
  await expect(status).toHaveAttribute("aria-live", "polite");
  await expect(button).toHaveAttribute("aria-disabled", "false");

  await button.click();

  await expect(button).toHaveAttribute("aria-disabled", "true");
  await expect(button).toContainText("Opening Google…");
  await expect(status).toContainText("Taking you to Google");
  // aria-disabled rather than the native disabled property, so the button
  // keeps focus. (Playwright's toBeDisabled() also honours aria-disabled, so
  // the DOM property is checked directly here.)
  expect(
    await button.evaluate((el) => (el as HTMLButtonElement).disabled),
    "native disabled would drop keyboard focus",
  ).toBe(false);
  await expect(button).toBeFocused();

  // A second press must not start another sign-in.
  await button.click({ force: true });
  await expect(button).toContainText("Opening Google…");
});

test("the sign-in form is reachable and operable by keyboard", async ({
  page,
}) => {
  await page.goto("/login");
  await page.evaluate(() => document.body.focus());
  await page.keyboard.press("Tab");
  await expect(page.locator(".skip-link")).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => document.activeElement?.id)).toBe(
    "auth-card",
  );

  // From the card, the next stop is the sign-in button itself.
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: /Continue with Google/ }),
  ).toBeFocused();
});

test("the sign-in page is not indexed", async ({ page }) => {
  const response = await page.goto("/login");
  expect(response?.status()).toBe(200);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );
});

for (const width of [390, 360]) {
  test(`the sign-in page fits a ${width}px screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/login");
    await expect(
      page.getByRole("button", { name: /Continue with Google/ }),
    ).toBeVisible();
    await expectNoOverflow(page);
    if (width === 390) await shot(page, "login-mobile");
  });
}

test("sign-in tap targets are at least 44px tall", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await expectTouchTargets(page);

  await page.evaluate(() => document.body.focus());
  await page.keyboard.press("Tab");
  const box = await page.locator(".skip-link").boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test("pinch zoom is left enabled", async ({ page }) => {
  await page.goto("/login");
  const viewport = await page
    .locator('meta[name="viewport"]')
    .getAttribute("content");
  expect(viewport ?? "").not.toContain("user-scalable=no");
  expect(viewport ?? "").not.toContain("maximum-scale=1");
});
