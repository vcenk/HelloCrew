import { test, expect, ask, nav, openDashboard, shot } from "./helpers";

test("a booking request waits for the owner, then clears from Today", async ({
  page,
}) => {
  await openDashboard(page, "/app/conversations");
  await expect(
    page.getByRole("heading", { name: "Conversations", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Book a visit", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Approve", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Skill · Booking requests", { exact: true }),
  ).toBeVisible();

  await nav(page, "Today");
  await expect(
    page.getByText("Approve a practice booking", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("All clear", { exact: true })).toBeVisible();

  await nav(page, "Conversations");
  await expect(page.getByText("Booking approved", { exact: true })).toBeVisible();
});

test("answers name the knowledge they came from", async ({ page }) => {
  await openDashboard(page, "/app/conversations");
  await page.getByRole("button", { name: "A price", exact: true }).click();
  await expect(
    page.getByText("Knowledge · Service catalog", { exact: true }),
  ).toBeVisible();
  await shot(page, "conversations-desktop");
});

test("an unanswerable question offers to teach the answer", async ({ page }) => {
  await openDashboard(page, "/app/conversations");
  await ask(page, "Do you have wifi?");
  await expect(
    page.getByRole("link", { name: "Teach this answer", exact: true }).first(),
  ).toBeVisible();

  await nav(page, "Today");
  await expect(page.getByText("“Do you have wifi?”")).toBeVisible();
  await page
    .getByRole("link", { name: "Teach this answer", exact: true })
    .first()
    .click();
  await page.waitForURL("**/app/knowledge");
  await expect(
    page.getByRole("heading", { name: "Add knowledge" }),
  ).toBeVisible();
  await expect(page.getByLabel("Customer question")).toHaveValue(
    "Do you have wifi?",
  );
});

test("the owner can take over a chat and hand it back", async ({ page }) => {
  await openDashboard(page, "/app/conversations");
  await ask(page, "Are you open on Sunday?");

  await page.getByRole("button", { name: "Take over", exact: true }).click();
  await expect(page.getByText("You’re in the chat", { exact: true })).toBeVisible();

  await page
    .getByLabel("Reply as the business", { exact: true })
    .fill("Hi, it's the owner here.");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.locator(".bubble-owner").getByText("Hi, it's the owner here."),
  ).toBeVisible();

  // While the owner is in the chat, customer messages get no AI reply.
  await page
    .getByRole("radiogroup", { name: "Write as" })
    .getByRole("radio", { name: "Customer" })
    .click();
  const assistantReplies = page.locator(".row-assistant:not(.row-owner)");
  const before = await assistantReplies.count();
  await ask(page, "Thanks!");
  await expect(page.locator(".bubble-customer").getByText("Thanks!")).toBeVisible();
  await expect(assistantReplies).toHaveCount(before);

  await page.getByRole("button", { name: "Hand back to AI", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Take over", exact: true }),
  ).toBeVisible();
});

test("the practice conversation survives a refresh in the same tab", async ({
  page,
}) => {
  await openDashboard(page, "/app/conversations");
  await ask(page, "Where are you?");
  await expect(page.locator(".bubble-customer").getByText("Where are you?")).toBeVisible();

  await page.reload();
  await expect(
    page.locator(".bubble-customer").getByText("Where are you?"),
  ).toBeVisible();
});
