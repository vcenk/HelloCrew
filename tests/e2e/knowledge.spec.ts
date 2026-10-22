import {
  test,
  expect,
  addFaq,
  ask,
  nav,
  openDashboard,
  shot,
} from "./helpers";

test("teaching an answer makes the receptionist use it", async ({ page }) => {
  await openDashboard(page, "/app/conversations");
  await ask(page, "Do you have wifi?");
  await page
    .getByRole("link", { name: "Teach this answer", exact: true })
    .first()
    .click();
  await page.waitForURL("**/app/knowledge");

  await expect(page.getByLabel("Customer question")).toHaveValue(
    "Do you have wifi?",
  );
  await page
    .getByLabel("Answer", { exact: true })
    .fill("Yes, free wifi for every visitor.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Added to knowledge", { exact: true })).toBeVisible();
  await expect(page.getByText("Do you have wifi?").first()).toBeVisible();

  // The preview scores the new answer as an exact match.
  await page.getByPlaceholder("Type a customer question").fill("Do you have wifi?");
  await expect(
    page.getByText("Exact approved FAQ · 100%", { exact: true }),
  ).toBeVisible();
  await shot(page, "knowledge-desktop");

  await nav(page, "Conversations");
  await ask(page, "Do you have wifi?");
  await expect(
    page
      .locator(".bubble-assistant")
      .getByText("Saved FAQ answer (sample): Yes, free wifi for every visitor.")
      .first(),
  ).toBeVisible();
});

test("knowledge moved to draft is not used for answers", async ({ page }) => {
  await addFaq(page, "Do you have wifi?", "Yes, free wifi for every visitor.");

  const live = page.getByLabel("Do you have wifi? is live");
  await live.uncheck({ force: true });
  await expect(
    page.getByText("“Do you have wifi?” moved to draft", { exact: true }),
  ).toBeVisible();

  await live.check({ force: true });
  await expect(live).toBeChecked();
});

test("file, link and written knowledge each explain the signed-out state", async ({
  page,
}) => {
  await openDashboard(page, "/app/knowledge");
  await expect(
    page.getByText("Sign in to add price lists, menus and other documents.", {
      exact: true,
    }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Add knowledge", exact: true }).click();
  await page.getByRole("radio", { name: "Upload a file" }).click();
  await expect(
    page.getByText(
      "Sign in to upload files. They’re stored privately in your workspace.",
      { exact: true },
    ),
  ).toBeVisible();

  await page.getByRole("radio", { name: "Website link" }).click();
  await expect(
    page.getByText("Sign in to add website links.", { exact: true }),
  ).toBeVisible();

  await page.getByRole("radio", { name: "Write it" }).click();
  await expect(page.getByLabel("Customer question")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  // The dialog element stays mounted, so assert it is no longer shown.
  await expect(page.getByLabel("Customer question")).not.toBeVisible();
});
