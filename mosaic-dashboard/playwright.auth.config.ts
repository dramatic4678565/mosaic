import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for accounts: magic link, guest claim, sharing, sign out.
 *
 * ## Why a separate config rather than more specs in the main one
 *
 * The main suite builds the dashboard with **no** `VITE_API_URL`, which selects the
 * IndexedDB backend and means the app never makes an API request. That is the right
 * default: it keeps the suite hermetic and fast, and it is exactly what a
 * signed-out visitor gets. But it also means those specs *cannot* exercise accounts,
 * because `lib/auth.ts` reports "no accounts in this build" without a server.
 *
 * So this config builds in `e2e-auth` mode, where `VITE_API_URL` is present, and
 * mounts the in-memory mock API on the same origin. Only `auth-flow.spec.ts` runs
 * here; everything else keeps running in the main suite against real local storage.
 *
 * ## What the mock is and is not
 *
 * It is a browser-drivable stand-in so a real user journey can be walked end to end.
 * It is not a second implementation to keep in step: the real handlers are verified
 * against Postgres directly and their logic is unit tested. See `e2e/mock-api.mjs`.
 *
 * Port 3102 so this can never collide with the main suite's server on 3101, and
 * `reuseExistingServer` is off — a stale server from a previous run would be
 * answering with yesterday's mock state, which is a genuinely baffling failure.
 */

const PORT = 3102;
const EDITOR_BASE = "/editor";

/**
 * The shared warm-up hard-codes 3101, and it runs in the Playwright *runner*
 * process — so putting these in `webServer.env` would not reach it. They are set
 * here instead, at module scope, which is evaluated in the runner before
 * `globalSetup` runs. Without them every run logs a connection refused against a
 * port nothing is listening on, which reads like a real failure.
 */
process.env.MOSAIC_E2E_DASHBOARD_URL ??= `http://localhost:${PORT}`;
process.env.MOSAIC_E2E_EDITOR_URL ??= `http://localhost:${PORT}${EDITOR_BASE}/`;

export default defineConfig({
  testDir: "./e2e",
  /**
   * Everything except this suite's spec. The main suite owns the rest, and several
   * of those specs assert IndexedDB behaviour that API mode deliberately changes.
   */
  testMatch: /auth-flow\.spec\.ts/,
  // Warms the served bundles, same as the main config.
  globalSetup: "./e2e/global-setup.ts",
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  outputDir: "test-results-auth",
  use: {
    baseURL: `http://localhost:${PORT}`,
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
      command: "node e2e/preview-server.mjs",
      url: `http://localhost:${PORT}/`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: String(PORT),
        EDITOR_BASE,
        DASHBOARD_DIST: "./dist",
        EDITOR_BUILD: "../excalidraw-app/build",
        // The whole reason this config exists.
        MOCK_API: "1",
      },
    },
  ],
});
