import { defineConfig, devices } from "@playwright/test";

// The specs drive the real UI, so they run against a production build: the
// `next dev` overlay sits on top of the page and swallows clicks on the
// website-chat iframe.
const port = Number(process.env.PORT ?? 3000);
const baseURL = process.env.BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // Each spec builds up its own practice data in localStorage/sessionStorage,
  // so files are independent — but they share one server, and the practice
  // agent is deliberately slow, so keep concurrency modest.
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Set BASE_URL to point at a server you already have running.
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: `npm run build && npm run start -- --port ${port}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
