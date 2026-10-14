import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.screenshot({
  path: "/tmp/hellocrew-landing-desktop.png",
  fullPage: true,
});
const authPage = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,
});
authPage.on("pageerror", (e) => errors.push(`auth: ${e.message}`));
await authPage.goto(`${baseUrl}/workspace`, { waitUntil: "networkidle" });
await authPage.waitForURL("**/login");
await authPage
  .getByRole("button", { name: "Continue with Google", exact: true })
  .waitFor();
await authPage
  .getByText("Tenant data is protected with row-level security.", {
    exact: false,
  })
  .waitFor();
await authPage.screenshot({
  path: "/tmp/hellocrew-login-desktop.png",
  fullPage: true,
});
await authPage.setViewportSize({ width: 390, height: 844 });
assert.equal(
  await authPage.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  ),
  true,
);
await authPage.screenshot({
  path: "/tmp/hellocrew-login-mobile.png",
  fullPage: true,
});
await authPage.close();
await page
  .getByRole("link", { name: "Try the practice demo", exact: true })
  .click();
await page.waitForURL("**/app");
await page.screenshot({
  path: "/tmp/hellocrew-studio-desktop.png",
  fullPage: true,
});
await page
  .getByRole("heading", { name: "How the parts fit together", exact: true })
  .waitFor();
assert.equal(await page.locator(".setup-map-card").count(), 4);
await page
  .getByRole("button", { name: "Conversations", exact: false })
  .first()
  .click();
await page.waitForURL("**/app?section=conversations");
await page
  .getByRole("button", { name: "Can I book a studio visit?", exact: false })
  .click();
await page
  .getByRole("button", { name: "Approve sample", exact: true })
  .waitFor();
await page.screenshot({
  path: "/tmp/hellocrew-approval-desktop.png",
  fullPage: true,
});
await page.getByRole("button", { name: "Approve sample", exact: true }).click();
await page
  .getByText(
    "Practice booking approved. A simulated confirmation is ready; no real appointment was made.",
    { exact: true },
  )
  .waitFor();
assert.equal(
  await page
    .getByRole("button", { name: "Approve sample", exact: true })
    .count(),
  0,
);
await page.getByRole("button", { name: "Home", exact: true }).click();
await page
  .getByRole("button", { name: "Conversations", exact: false })
  .first()
  .click();
assert.equal(
  await page.getByText("Approved (demo)", { exact: true }).count(),
  1,
);
page.once("dialog", (dialog) => dialog.accept());
await page.getByRole("button", { name: "Start fresh", exact: false }).click();
await page
  .getByText("Hello! What can I help you find today?", { exact: true })
  .waitFor();
await page
  .getByRole("button", { name: "Can I book a studio visit?", exact: false })
  .click();
await page.getByRole("button", { name: "Decline", exact: true }).click();
await page
  .getByText("Practice booking declined. Nothing was booked.", { exact: true })
  .waitFor();
await page
  .getByRole("button", { name: "How much is one studio visit?", exact: false })
  .click();
await page
  .getByText(
    "Sample catalog entries: Studio visit: $40 USD. These are listed sample prices, not a calculated total or a real offer.",
    { exact: true },
  )
  .waitFor();
await page
  .getByRole("button", { name: "Can I speak with a person?", exact: false })
  .click();
await page
  .getByText(
    "A person would need to help with that. This practice mode cannot send a handoff or contact anyone.",
    { exact: true },
  )
  .waitFor();
await page.getByRole("button", { name: "Your assistant", exact: true }).click();
await page
  .getByRole("heading", { name: "Assistant identity", exact: true })
  .waitFor();
await page
  .locator(".assistant-purpose-picker button")
  .filter({ hasText: "Booking assistant" })
  .click();
await page.locator('input[name="assistant-name"]').evaluate((input) => {
  if (!(input instanceof HTMLInputElement) || input.value !== "Booking guide") {
    throw new Error("Booking starter did not apply its default identity.");
  }
});
await page
  .getByText("Share the booking link", { exact: true })
  .first()
  .waitFor();
await page.screenshot({
  path: "/tmp/hellocrew-assistant-identity-desktop.png",
  fullPage: true,
});
await page
  .getByRole("button", {
    name: "Save & continue to Business profile",
    exact: true,
  })
  .click();
await page
  .getByRole("heading", { name: "Business profile", exact: true })
  .waitFor();
await page.screenshot({
  path: "/tmp/hellocrew-business-profile-desktop.png",
  fullPage: true,
});
await page.locator('input[name="booking-url"]').fill("javascript:alert(1)");
await page
  .getByRole("button", {
    name: "Save & continue to Knowledge",
    exact: true,
  })
  .click();
await page
  .getByText("Use a full http or https link", { exact: false })
  .waitFor();
await page
  .locator('input[name="booking-url"]')
  .fill("https://example.com/book");
await page
  .getByRole("button", {
    name: "Save & continue to Knowledge",
    exact: true,
  })
  .click();
await page.getByText("Business knowledge", { exact: true }).waitFor();
await page.getByRole("button", { name: "Test retrieval", exact: true }).click();
await page.getByText("Exact approved FAQ", { exact: false }).waitFor();
await page.getByRole("button", { name: "Add knowledge", exact: true }).click();
await page
  .getByLabel("Customer question", { exact: true })
  .fill("Do you offer gift cards?");
await page
  .getByLabel("Approved answer", { exact: true })
  .fill("Yes, sample gift cards are available.");
await page.getByRole("button", { name: "Save draft", exact: true }).click();
const giftCardSource = page
  .getByRole("article")
  .filter({ hasText: "Do you offer gift cards?" });
await giftCardSource
  .getByRole("button", { name: "Approve", exact: true })
  .click();
await page
  .getByText("Source approved and available to practice retrieval.", {
    exact: true,
  })
  .waitFor();
await page.screenshot({
  path: "/tmp/hellocrew-knowledge-desktop.png",
  fullPage: true,
});
await page
  .getByRole("button", { name: "Conversations", exact: false })
  .first()
  .click();
await page
  .getByLabel("Your practice question", { exact: true })
  .fill("Do you offer gift cards?");
await page
  .getByRole("button", { name: "Send practice question", exact: true })
  .click();
await page
  .getByText(
    "Saved FAQ answer (sample): Yes, sample gift cards are available.",
    { exact: true },
  )
  .waitFor();
await page
  .getByLabel("Your practice question", { exact: true })
  .fill("What is your refund policy?");
await page
  .getByRole("button", { name: "Send practice question", exact: true })
  .click();
await page
  .getByText(
    "I’m not certain from the approved information. A person can help before you book. Practice mode has not contacted anyone.",
    { exact: true },
  )
  .waitFor();
await page.getByRole("button", { name: "Channels", exact: true }).click();
await page
  .getByRole("heading", { name: "Publish and install the website chat." })
  .waitFor();
await page.getByText("created-after-publish", { exact: false }).waitFor();
await page.getByText("Booking guide", { exact: true }).first().waitFor();
await page
  .getByText(
    "Hello! I can help you find the right service and booking option.",
    { exact: true },
  )
  .waitFor();
await page.getByText("Configured", { exact: true }).waitFor();
await page.getByText("Practice knowledge available", { exact: true }).waitFor();
await page.getByText("Not saved", { exact: true }).waitFor();
await page.getByText("Test reviewed", { exact: true }).waitFor();
await page
  .getByText("3 of 4 practice inputs ready", { exact: true })
  .first()
  .waitFor();
await page
  .getByRole("button", { name: "Close website chat preview", exact: true })
  .click();
await page.getByRole("button", { name: "Show preview", exact: true }).click();
await page.waitForTimeout(400);
await page.screenshot({
  path: "/tmp/hellocrew-website-channel-desktop.png",
  fullPage: true,
});
await page
  .getByRole("button", { name: "Review in Workflows", exact: true })
  .click();
await page.waitForURL("**/app?section=workflows");
await page.getByText("Choose the closest fit.", { exact: true }).waitFor();
await page
  .getByText("RECOMMENDED FOR BOOKING ASSISTANT", { exact: true })
  .waitFor();
await page
  .getByRole("heading", {
    name: "Salon reception is the closest fit.",
    exact: true,
  })
  .waitFor();
await page
  .getByText(
    "Suggestion only · Nothing is added until you choose a template.",
    { exact: true },
  )
  .waitFor();
await page.screenshot({
  path: "/tmp/hellocrew-template-library-desktop.png",
  fullPage: true,
});
await page.setViewportSize({ width: 390, height: 844 });
assert.ok(
  await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  ),
);
await page.screenshot({
  path: "/tmp/hellocrew-template-library-mobile.png",
  fullPage: true,
});
await page.setViewportSize({ width: 1440, height: 1000 });
await page
  .getByRole("button", { name: "Use this template", exact: true })
  .first()
  .click();
await page
  .getByText("Ready to save as a safe draft", { exact: true })
  .waitFor();
await page.getByRole("button", { name: /Step 3 Draft a response/ }).click();
await page
  .getByLabel("Supported languages", { exact: false })
  .fill("EN, FA, ZH, ES");
await page.screenshot({
  path: "/tmp/hellocrew-workflow-desktop.png",
  fullPage: true,
});
await page.getByRole("button", { name: "Test safely", exact: true }).click();
await page.getByText("Safe test plan", { exact: true }).waitFor();
await page.getByText("0 external writes", { exact: true }).waitFor();
await page.getByRole("button", { name: "Save workflow", exact: true }).click();
await page
  .getByRole("button", { name: "Saved to My workflows", exact: true })
  .waitFor();
await page.getByRole("button", { name: "Publish v1", exact: true }).click();
await page.getByRole("button", { name: "Publish v2", exact: true }).waitFor();
assert.ok(
  await page.evaluate(() => localStorage.getItem("hellocrew:workflows:v2")),
);
await page.getByRole("button", { name: "My workflows", exact: true }).click();
await page.getByText("Salon reception", { exact: true }).last().waitFor();
await page.getByText("published", { exact: true }).waitFor();
await page.getByRole("button", { name: "Channels", exact: true }).click();
await page.getByText("Published v1", { exact: true }).waitFor();
await page
  .getByText("4 of 4 practice inputs ready", { exact: true })
  .first()
  .waitFor();
await page.screenshot({
  path: "/tmp/hellocrew-website-channel-ready-desktop.png",
  fullPage: true,
});
await page.getByRole("button", { name: "Settings", exact: true }).click();
page.once("dialog", (dialog) => dialog.accept());
await page
  .getByRole("button", { name: "Clear practice session", exact: false })
  .click();
await page
  .getByText("Current session: 0 practice turns.", { exact: true })
  .waitFor();
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole("button", { name: "Home", exact: true }).click();
assert.ok(
  await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  ),
);
await page.screenshot({
  path: "/tmp/hellocrew-studio-mobile.png",
  fullPage: true,
});
await page.getByRole("button", { name: "Your assistant", exact: true }).click();
await page
  .getByRole("heading", { name: "Assistant identity", exact: true })
  .waitFor();
assert.ok(
  await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  ),
);
await page.screenshot({
  path: "/tmp/hellocrew-assistant-identity-mobile.png",
  fullPage: true,
});
await page.getByRole("button", { name: "Channels", exact: true }).click();
await page
  .getByRole("heading", { name: "Publish and install the website chat." })
  .waitFor();
await page.getByText("Published v1", { exact: true }).waitFor();
await page.getByText("Not reviewed", { exact: true }).waitFor();
await page
  .getByText("3 of 4 practice inputs ready", { exact: true })
  .first()
  .waitFor();
await page.waitForTimeout(700);
assert.ok(
  await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  ),
);
await page.screenshot({
  path: "/tmp/hellocrew-website-channel-mobile.png",
  fullPage: true,
});
await page.getByRole("button", { name: "Workflows", exact: true }).click();
await page.getByRole("button", { name: "Edit information" }).click();
await page
  .getByText("Ready to save as a safe draft", { exact: true })
  .waitFor();
assert.ok(
  await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  ),
);
await page.screenshot({
  path: "/tmp/hellocrew-workflow-mobile.png",
  fullPage: true,
});
await page.getByRole("button", { name: "Home", exact: true }).click();
await page.waitForURL("**/app");
await page
  .getByRole("button", { name: /Test Review the customer experience/ })
  .click();
await page.waitForURL("**/app?section=conversations");
await page
  .getByRole("button", { name: "What are your opening hours?", exact: false })
  .click();
await page
  .getByText("Saved sample hours: Monday–Friday, 9am–5pm", { exact: true })
  .waitFor();
assert.ok(
  await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  ),
);
await page.screenshot({
  path: "/tmp/hellocrew-conversation-mobile.png",
  fullPage: true,
});
await page.reload();
await page
  .getByRole("button", { name: "Conversations", exact: false })
  .first()
  .click();
await page
  .getByText(
    "Hello! I can help you find the right service and booking option.",
    { exact: true },
  )
  .waitFor();
await page.goto(baseUrl, { waitUntil: "networkidle" });
assert.ok(
  await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  ),
);
await page.screenshot({
  path: "/tmp/hellocrew-landing-mobile.png",
  fullPage: true,
});
assert.deepEqual(errors, []);
console.log(
  "Browser QA passed: desktop/mobile, shared assistant identity, calculated channel readiness before/after workflow publishing and conversation reset, purpose-aware workflow recommendations, organized setup map, deep-linked sections, website-channel guide, workflow canvas/save, all scenarios, approve/decline, refresh, overflow, no page errors.",
);
await browser.close();
