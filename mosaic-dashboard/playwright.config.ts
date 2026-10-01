import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for the Mosaic dashboard.
 *
 * Two servers are started, because the dashboard and the editor are separate
 * apps that must talk to each other over same-origin IndexedDB:
 *
 * - `editor` : excalidraw-app dev server. The dashboard loads it in an iframe
 *              with `#board=<id>` so the "open editor" leg of the smoke test can
 *              draw, save and capture a real thumbnail.
 * - `dashboard` : this app's dev server.
 *
 * The dashboard points its iframe at the editor through `VITE_EDITOR_URL`, which
 * the webServer block below sets. That is what makes the two origins differ in
 * dev; in production both are same-origin behind one nginx, which is why the
 * IndexedDB handoff works either way.
 */
export default defineConfig({
  testDir: "./e2e",
  // Serial: every spec shares one IndexedDB origin and one dev server, so
  // running them in parallel would let specs stomp each other's boards.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [
    ["list"],
    // Video + trace so a failure in CI can be diagnosed without a rerun.
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  outputDir: "test-results",
  use: {
    baseURL: "http://localhost:3101",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      // Editor dev server. `excalidraw-app/.env.development` sets
      // VITE_APP_PORT=3001, which would collide with the dashboard's default, so
      // the port is overridden here. Vite reads VITE_APP_PORT from the process
      // env with higher precedence than the .env file.
      command: "yarn --cwd ../excalidraw-app vite --port 3000",
      url: "http://localhost:3000/editor/",
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
      env: {
        VITE_APP_PORT: "3000",
        // Serve the editor under /editor/ so every module URL it emits is
        // prefixed. The dashboard proxies /editor -> this server without
        // rewriting, so the prefix has to be consistent end to end.
        EXCALIDRAW_BASE_PATH: "/editor",
        // Disable vite-plugin-checker for e2e. The editor dev server runs
        // eslint in-process through that plugin and it crashes the whole dev
        // server under the parallel e2e load. Linting is covered separately by
        // `yarn test:code`, so nothing is lost by skipping it here.
        VITE_APP_ENABLE_ESLINT: "false",
      },
    },
    {
      command: "yarn dev",
      url: "http://localhost:3101",
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
      env: {
        VITE_APP_PORT: "3101",
        // Absolute editor origin for the dev proxy target.
        VITE_EDITOR_ORIGIN: "http://localhost:3000",
        // Serve the dashboard from `/` during e2e so baseURL paths need no
        // prefix. Production sets this to `/dashboard/`.
        MOSAIC_DASHBOARD_BASE: "/",
      },
    },
  ],
});
