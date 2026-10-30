import { test, expect, openDashboard } from "./helpers";
import type { Page } from "@playwright/test";

/**
 * What the owner sees when a workflow changes somewhere else — the Copilot
 * writing it on the server, or another tab.
 *
 * The Copilot's own turn needs a model, and these do not test one. The seam
 * is further down and is the part that was broken: the sync takes the
 * server's copy into browser storage and announces it, and the builder has
 * to notice. Everything below that line drives the real UI.
 */

const STORAGE_KEY = "hellocrew:workflows:v2";
const PULLED_EVENT = "hellocrew:workspace-pulled";

/** Starts a workflow from a template and saves it, through the real UI. */
async function saveATemplate(page: Page) {
  await openDashboard(page, "/app/workflows");
  await page.getByRole("button", { name: "Use this template" }).first().click();
  await expect(page.getByLabel("Workflow name")).toBeVisible();
  await page.getByRole("button", { name: "Save workflow", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Saved to My workflows" }),
  ).toBeVisible();
}

/**
 * Exactly what useWorkspaceSync.adopt() does once the Copilot has written on
 * the server: replace this browser's copy, then say so.
 */
async function arrivesFromServer(page: Page, newName: string) {
  await page.evaluate(
    ([key, event, name]) => {
      const store = JSON.parse(localStorage.getItem(key) ?? "{}");
      store.workflows[0].workflow.name = name;
      store.workflows[0].updatedAt = new Date().toISOString();
      localStorage.setItem(key, JSON.stringify(store));
      window.dispatchEvent(
        new CustomEvent(event, { detail: { key: "workflows" } }),
      );
    },
    [STORAGE_KEY, PULLED_EVENT, newName] as const,
  );
}

const library = (page: Page) => page.locator(".my-workflow-card h3");
const notice = (page: Page) => page.locator(".workflow-pulled-notice");

test("the library shows a chat edit without a reload", async ({ page }) => {
  await saveATemplate(page);
  await page.locator(".workflow-back").click();
  await page.getByRole("tab", { name: /My workflows/ }).click();
  await expect(library(page)).toHaveCount(1);

  await arrivesFromServer(page, "Renamed in chat");

  // The whole point: no page.reload() between the change and this.
  await expect(library(page)).toHaveText("Renamed in chat");
});

test("an open editor is offered the new copy, not given it", async ({ page }) => {
  // Replacing the draft underneath somebody mid-edit would throw away what
  // they are typing, so the canvas keeps their copy until they say.
  await saveATemplate(page);
  const name = page.getByLabel("Workflow name");
  const mine = await name.inputValue();

  await arrivesFromServer(page, "Renamed in chat");

  await expect(notice(page)).toContainText("changed somewhere else");
  await expect(name).toHaveValue(mine);
});

test("taking the new copy loads it onto the canvas", async ({ page }) => {
  await saveATemplate(page);
  await arrivesFromServer(page, "Renamed in chat");

  await page.getByRole("button", { name: "Load that version" }).click();
  await expect(page.getByLabel("Workflow name")).toHaveValue("Renamed in chat");
  await expect(notice(page)).toHaveCount(0);
});

test("keeping the draft leaves it exactly as it was", async ({ page }) => {
  await saveATemplate(page);
  const name = page.getByLabel("Workflow name");
  await name.fill("What I was typing");

  await arrivesFromServer(page, "Renamed in chat");
  await page.getByRole("button", { name: "Keep editing" }).click();

  await expect(notice(page)).toHaveCount(0);
  await expect(name).toHaveValue("What I was typing");
});

test("a change to another document leaves the workflow alone", async ({
  page,
}) => {
  // The event carries which document moved. Reacting to all of them would
  // interrupt the owner every time their knowledge synced.
  await saveATemplate(page);
  const name = page.getByLabel("Workflow name");
  await name.fill("What I was typing");

  // The workflows document really did change underneath, but the event says
  // knowledge moved — so the builder has no business reacting to it.
  await page.evaluate(
    ([key, event]) => {
      const store = JSON.parse(localStorage.getItem(key) ?? "{}");
      store.workflows[0].workflow.name = "Renamed in chat";
      localStorage.setItem(key, JSON.stringify(store));
      window.dispatchEvent(
        new CustomEvent(event, { detail: { key: "knowledge" } }),
      );
    },
    [STORAGE_KEY, PULLED_EVENT] as const,
  );

  await expect(notice(page)).toHaveCount(0);
  await expect(name).toHaveValue("What I was typing");
});
