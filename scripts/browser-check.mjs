import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const shots = process.env.SHOTS_DIR ?? "/tmp";
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

const shot = (name) =>
  page.screenshot({ path: `${shots}/hellocrew-${name}.png`, fullPage: true });
const text = (value) => page.getByText(value, { exact: true }).first().waitFor();
const button = (name) => page.getByRole("button", { name, exact: true });
const noOverflow = async () =>
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    `horizontal overflow on ${page.url()}`,
  );

// Dashboard navigation lives in a drawer on small screens.
async function nav(name) {
  const menu = button("Open menu");
  if (await menu.isVisible()) await menu.click();
  await page
    .locator(".dash-sidebar")
    .getByRole("link", { name, exact: true })
    .first()
    .click();
}

async function ask(question) {
  await page.getByLabel("Message as a customer", { exact: true }).first().fill(question);
  await button("Send message").first().click();
}

// ---------- Landing and login ----------
await page.goto(baseUrl, { waitUntil: "networkidle" });
await shot("landing-desktop");

// Needs the Supabase env vars; set SKIP_AUTH_CHECK=1 to skip locally.
if (process.env.SKIP_AUTH_CHECK !== "1") {
  const authPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  authPage.on("pageerror", (e) => errors.push(`auth: ${e.message}`));
  await authPage.goto(`${baseUrl}/workspace`, { waitUntil: "networkidle" });
  await authPage.waitForURL("**/login");
  await authPage.getByRole("button", { name: "Continue with Google", exact: true }).waitFor();
  await authPage.screenshot({ path: `${shots}/hellocrew-login-desktop.png`, fullPage: true });
  await authPage.close();
}

// ---------- Today ----------
await page.getByRole("link", { name: "Try the practice demo", exact: true }).click();
await page.waitForURL("**/app");
await page.getByRole("heading", { name: "Needs you" }).waitFor();
await text("All clear");
await page.getByRole("heading", { name: "Your crew" }).waitFor();
assert.equal(await page.locator(".crew-tile").count(), 3);
await page.locator(".crew-tile", { hasText: "Reputation manager" }).first().waitFor();
await shot("today-desktop");

// Old section links still land on the new pages.
await page.goto(`${baseUrl}/app/inbox`);
await page.waitForURL("**/app/conversations");
await page.goto(`${baseUrl}/app?section=assistant`);
await page.waitForURL("**/app/crew/receptionist/personality");

// ---------- Conversations: approvals, sources and teaching ----------
await nav("Conversations");
await page.waitForURL("**/app/conversations");
await page.getByRole("heading", { name: "Conversations", exact: true }).waitFor();
await button("Book a visit").click();
await button("Approve").waitFor();
await text("Skill · Booking requests");
await nav("Today");
await text("Approve a practice booking");
await button("Approve").click();
await text("All clear");

await nav("Conversations");
await text("Booking approved");
await button("A price").click();
await text("Knowledge · Service catalog");
await ask("Do you have wifi?");
await page.getByRole("link", { name: "Teach this answer", exact: true }).first().waitFor();
await shot("conversations-desktop");

await nav("Today");
await text("“Do you have wifi?”");
await page.getByRole("link", { name: "Teach this answer", exact: true }).click();
await page.waitForURL("**/app/knowledge");
await page.getByRole("heading", { name: "Add knowledge" }).waitFor();
assert.equal(await page.getByLabel("Customer question").inputValue(), "Do you have wifi?");
await page.getByLabel("Answer", { exact: true }).fill("Yes, free wifi for every visitor.");
await button("Save").click();
await text("Added to knowledge");
await text("Do you have wifi?");
await page.getByPlaceholder("Type a customer question").fill("Do you have wifi?");
await text("Exact approved FAQ · 100%");
await shot("knowledge-desktop");

await nav("Conversations");
await ask("Do you have wifi?");
await text("Saved FAQ answer (sample): Yes, free wifi for every visitor.");

// Take over: the owner replies, customer messages get no AI reply, then hand back.
await button("Take over").click();
await text("You’re in the chat");
await page.getByLabel("Reply as the business", { exact: true }).fill("Hi, it's the owner here.");
await button("Send message").click();
await page.locator(".bubble-owner").getByText("Hi, it's the owner here.").waitFor();
await page.getByRole("radiogroup", { name: "Write as" }).getByRole("radio", { name: "Customer" }).click();
const repliesBefore = await page.locator(".row-assistant:not(.row-owner)").count();
await ask("Thanks!");
await page.waitForTimeout(400);
assert.equal(await page.locator(".row-assistant:not(.row-owner)").count(), repliesBefore);
await button("Hand back to AI").click();
await button("Take over").waitFor();

// Files need an account: the upload tab explains that when signed out.
await nav("Knowledge");
await text("Sign in to add price lists, menus and other documents.");
await button("Add knowledge").click();
await page.getByRole("radio", { name: "Upload a file" }).click();
await text("Sign in to upload files. They’re stored privately in your workspace.");
await page.getByRole("radio", { name: "Website link" }).click();
await text("Sign in to add website links.");
await page.getByRole("radio", { name: "Write it" }).click();
await button("Cancel").click();

// Team and prices per staff member.
await page.locator(".team-group").getByRole("button", { name: "Add", exact: true }).click();
await page.getByLabel("Name", { exact: true }).last().fill("Ayşe");
await page.getByLabel("Role", { exact: true }).fill("Senior stylist");
await page.locator("#team-dialog-title").locator("..").getByRole("button", { name: "Save", exact: true }).click();
await text("Ayşe added to the team");
await page.locator(".team-group").getByRole("button", { name: "Add", exact: true }).click();
await page.getByLabel("Name", { exact: true }).last().fill("Mert");
await page.getByLabel("Role", { exact: true }).fill("Junior stylist");
await page.locator("#team-dialog-title").locator("..").getByRole("button", { name: "Save", exact: true }).click();
await text("Mert added to the team");
await page.locator(".kgroup").filter({ hasText: "Services & prices" }).getByRole("button", { name: "Add", exact: true }).click();
await page.getByLabel("Service", { exact: true }).fill("Haircut");
await page.getByText("Depends on who or which option").click();
await page.getByLabel("Option 1: who or what").selectOption({ label: "Ayşe · Senior stylist" });
await page.getByLabel("Option 1 price").fill("$60");
await page.getByLabel("Option 1 time").fill("45 min");
await button("Add a price").click();
await page.getByLabel("Option 2: who or what").selectOption({ label: "Mert · Junior stylist" });
await page.getByLabel("Option 2 price").fill("$40");
await page.locator("#kdialog-title").locator("..").getByRole("button", { name: "Save", exact: true }).click();
await text("Added to knowledge");
await text("$40–$60");
await text("Ayşe $60");
await page.locator(".staff-filter").getByRole("button", { name: "Mert", exact: true }).click();
assert.equal(await page.locator(".kgroup").filter({ hasText: "Opening hours" }).count(), 0);
await text("Mert $40");
await page.locator(".staff-filter").getByRole("button", { name: "Everyone", exact: true }).click();
await shot("knowledge-team-desktop");
await nav("Conversations");
await ask("How much is a haircut?");
await page.getByText("Haircut: $40–$60", { exact: false }).first().waitFor();

// Draft knowledge is not used.
await nav("Knowledge");
await page.getByLabel("Do you have wifi? is live").uncheck({ force: true });
await text("“Do you have wifi?” moved to draft");
await page.getByLabel("Do you have wifi? is live").check({ force: true });

// ---------- Crew: skills change what the receptionist does ----------
await nav("Crew");
await page.waitForURL("**/app/crew");
await text("Add to your crew");
assert.equal(await page.locator(".hire-card").count(), 1);
assert.equal(await page.locator(".agent-card").count(), 2);
await shot("crew-desktop");
await page.locator(".agent-card", { hasText: "Reputation manager" }).click();
await page.waitForURL("**/app/crew/reputation");
await page.getByRole("heading", { name: "Reputation manager" }).first().waitFor();
await shot("reputation-desktop");
await page.goBack();
await page.waitForURL("**/app/crew");
await page.locator(".agent-card").first().click();
await page.waitForURL("**/app/crew/receptionist");
await page.getByRole("radiogroup", { name: "Booking requests mode" }).getByRole("radio", { name: "Off" }).click();
await text("Booking requests: Off");
await page.locator(".agent-try").getByRole("button", { name: "Book a visit", exact: true }).click();
await page.locator(".agent-try").getByText("I can’t take bookings here.", { exact: false }).waitFor();
await shot("agent-skills-desktop");
await page.getByRole("radiogroup", { name: "Booking requests mode" }).getByRole("radio", { name: "Ask me first" }).click();

// Personality saves and renames the agent everywhere.
await page.getByRole("tab", { name: "Personality" }).click();
await page.waitForURL("**/personality");
await page.getByLabel("Name", { exact: true }).fill("Mila");
await button("Save personality").click();
await text("Personality saved");
await page.getByRole("heading", { name: "Mila", exact: true }).waitFor();
await shot("agent-personality-desktop");

// Channels: website chat preview and the installed widget.
await page.getByRole("tab", { name: "Channels" }).click();
await page.waitForURL("**/channels");
await text("Website chat");
const widgetFrameResponse = await page.request.get(`${baseUrl}/widget/demo-hellocrew`);
assert.equal(widgetFrameResponse.status(), 200);
assert.match(widgetFrameResponse.headers()["content-security-policy"], /frame-ancestors \*/);
const popup = page.waitForEvent("popup");
await page.getByRole("link", { name: "Open test website", exact: true }).click();
const widgetPage = await popup;
widgetPage.on("pageerror", (e) => errors.push(`widget: ${e.message}`));
await widgetPage.waitForLoadState("networkidle");
const embedded = widgetPage.frameLocator('iframe[title="Chat with this business"]');
await embedded.getByRole("button", { name: "Open website chat", exact: true }).click();
await embedded.getByRole("button", { name: "When are you open?", exact: true }).click();
await embedded.getByText("Saved sample hours:", { exact: false }).waitFor();
await widgetPage.close();
await shot("agent-channels-desktop");

// The advanced workflow editor stays reachable from Skills.
await page.getByRole("tab", { name: "Skills" }).click();
await page.getByRole("link", { name: /Advanced workflow editor/ }).click();
await page.waitForURL("**/app/workflows");
await page.getByRole("heading", { name: "Workflow editor" }).waitFor();

// ---------- Settings and theme ----------
await nav("Settings");
await page.getByRole("heading", { name: "Live AI" }).waitFor();
await page.locator(".dash-theme").getByRole("radio", { name: "Dark" }).click();
await nav("Today");
await page.locator('.dash[data-theme="dark"]').waitFor();
await shot("today-dark");
await nav("Crew");
await page.locator(".agent-card").first().click();
await shot("agent-dark");
await page.locator(".dash-theme").getByRole("radio", { name: "Light" }).click();

// ---------- Mobile ----------
await page.setViewportSize({ width: 390, height: 844 });
for (const [name, file] of [
  ["Today", "today-mobile"],
  ["Conversations", "conversations-mobile"],
  ["Crew", "crew-mobile"],
  ["Knowledge", "knowledge-mobile"],
]) {
  await nav(name);
  await page.waitForTimeout(250);
  await noOverflow();
  await shot(file);
}
await page.goto(`${baseUrl}/app/crew/receptionist`);
await page.waitForTimeout(250);
await noOverflow();
await shot("agent-mobile");

// The test conversation survives a refresh within the same tab.
await nav("Conversations");
await page.reload();
await text("Saved FAQ answer (sample): Yes, free wifi for every visitor.");

await page.goto(baseUrl, { waitUntil: "networkidle" });
await noOverflow();
await shot("landing-mobile");

assert.deepEqual(errors, []);
console.log(
  "Browser QA passed: Today, Conversations (approvals, used chips, teach loop), Knowledge (add, preview, draft), Crew skills gating practice replies, personality, channels + installed widget, workflow editor, dark theme, mobile overflow, refresh, no page errors.",
);
await browser.close();
