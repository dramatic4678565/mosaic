import { defineConfig, devices } from "@playwright/test";

/**
 * Collaboration latency suite.
 *
 * Separate from `playwright.config.ts` on purpose. That suite builds the apps and
 * serves them locally; this one needs a *live* room server to measure real
 * propagation, so it depends on outbound network and on that server being up.
 * Keeping them apart means a Render cold-start or an outage can never turn the
 * main e2e run red.
 *
 * Run: yarn --cwd mosaic-dashboard test:e2e:collab
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /collab-latency\.spec\.ts/,
  workers: 1,
  fullyParallel: false,
  // Render's free tier sleeps when idle; the first run has to outlast a cold
  // start before the steady-state measurement means anything.
  timeout: 240_000,
  expect: { timeout: 90_000 },
  reporter: [["list"]],
  outputDir: "test-results-collab",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1280, height: 800 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  /**
   * Serves our built editor. The room server only terminates WebSockets; it does
   * not serve the app, so the browser has to load our build — and it is that
   * build's VITE_APP_WS_SERVER_URL that points it at Render.
   *
   * Requires the **e2e** build (`yarn build:e2e`), not `yarn build`. The e2e
   * build sets the editor's base to /editor/ so it matches this server's mount
   * point; the default production build emits /assets/... which resolves to the
   * preview server's dashboard root and yields a blank page with no error.
   */
  webServer: {
    command: "node e2e/preview-server.mjs",
    url: "http://localhost:3101/editor/",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      PORT: "3101",
      EDITOR_BASE: "/editor",
      DASHBOARD_DIST: "./dist",
      EDITOR_BUILD: "../excalidraw-app/build",
    },
  },
});
