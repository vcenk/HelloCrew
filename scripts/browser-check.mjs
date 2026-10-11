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
await page
  .getByRole("link", { name: "Try the practice demo", exact: true })
  .click();
await page.waitForURL("**/app");
await page.screenshot({
  path: "/tmp/hellocrew-studio-desktop.png",
  fullPage: true,
});
await page
  .getByRole("button", { name: "Try an approval", exact: false })
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
await page.getByRole("button", { name: "Start fresh", exact: false }).click();
await page.getByText("It starts with a hello.", { exact: true }).waitFor();
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
  .getByLabel("Opening hours", { exact: true })
  .fill("Tuesday only, 10am–2pm");
await page
  .getByRole("button", { name: "Apply sample information", exact: true })
  .click();
await page
  .getByText(
    "Sample information applied. Your next free-text question will use it.",
  )
  .waitFor();
await page
  .getByRole("button", { name: "Conversations", exact: false })
  .first()
  .click();
await page
  .getByLabel("Your practice question", { exact: true })
  .fill("When are you open?");
await page
  .getByRole("button", { name: "Send practice question", exact: true })
  .click();
await page
  .getByText("Saved sample hours: Tuesday only, 10am–2pm", { exact: true })
  .waitFor();
await page
  .getByLabel("Your practice question", { exact: true })
  .fill("What is your refund policy?");
await page
  .getByRole("button", { name: "Send practice question", exact: true })
  .click();
await page
  .getByText("I don’t have a matching answer", { exact: false })
  .waitFor();
await page.getByRole("button", { name: "Your assistant", exact: true }).click();
await page
  .getByLabel("Sample booking link", { exact: true })
  .fill("javascript:alert(1)");
await page
  .getByRole("button", { name: "Apply sample information", exact: true })
  .click();
await page
  .getByText("Use a full http or https link", { exact: false })
  .waitFor();
await page.getByRole("button", { name: "Restore sample", exact: true }).click();
await page.getByRole("button", { name: "Channels", exact: true }).click();
assert.equal(await page.getByText("Not connected", { exact: true }).count(), 2);
await page.getByRole("button", { name: "Settings", exact: true }).click();
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
await page
  .getByRole("button", { name: "Dismiss welcome", exact: true })
  .click();
assert.equal(
  await page
    .getByRole("button", { name: "Say your first hello", exact: false })
    .count(),
  0,
);
await page
  .getByRole("button", { name: "Answer a question", exact: false })
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
await page.getByText("It starts with a hello.", { exact: true }).waitFor();
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
  "Browser QA passed: desktop/mobile, all scenarios, approve/decline, reset, refresh, navigation, dismiss, overflow, no page errors.",
);
await browser.close();
