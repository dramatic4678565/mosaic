import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for the Mosaic dashboard.
 *
 * The suite runs against **built** output served by one static server, not
 * against two Vite dev servers. Two reasons, both learned the hard way:
 *
 * 1. Memory. The excalidraw dev server plus its in-process TypeScript checker,
 *    the dashboard dev server, Chromium and the runner exhausted RAM on a 16 GB
 *    Windows machine and the dev server died mid-run, producing a wall of
 *    `ERR_CONNECTION_REFUSED`.
 * 2. Correctness. Production serves two built bundles from one nginx. Testing
 *    the built output exercises the real asset graph, base paths and routing —
 *    so a base-path mistake, which is precisely the class of bug this suite
 *    exists to catch, cannot hide behind dev-server conveniences.
 *
 * `e2e/preview-server.mjs` mirrors `docker/nginx.conf`: dashboard at `/`, editor
 * at `EDITOR_BASE`. `EDITOR_BASE` is passed to both the dashboard build
 * (`VITE_EDITOR_BASE`) and the server, so they cannot drift.
 *
 * For interactive development use `yarn start` in each app instead — that is
 * faster to iterate on and is what the dev proxy in vite.config.mts is for.
 */

const PORT = 3101;
const EDITOR_BASE = "/editor";

export default defineConfig({
  testDir: "./e2e",
  /**
   * `dev-smoke.spec.ts` is excluded here on purpose: it drives the *dev servers*
   * started by `yarn start`, which do not exist during this run (this config
   * builds the apps and serves them itself). It has its own config,
   * `playwright.dev.config.ts`, run with `yarn test:e2e:dev`.
   *
   * `menu-hide.spec.ts` is deliberately NOT excluded. Hiding the upstream menu
   * items is a shipped behaviour, so it is verified against the built bundle
   * rather than only against a dev server.
   * `collab-latency.spec.ts` is excluded for the same reason, plus it needs
   * outbound network access to the deployed room server — a Render cold start
   * must never be able to turn this hermetic suite red. It has its own config
   * (`playwright.collab.config.ts`, `yarn test:e2e:collab`).
   *
   * `auth-flow.spec.ts` cannot run here at all: this config builds the dashboard
   * with no `VITE_API_URL`, so the app has no backend and every account spec fails
   * on a missing `/api`. It needs the in-memory mock and an API-mode build, so it
   * has its own config (`playwright.auth.config.ts`, `yarn test:e2e:auth`).
   */
  testIgnore: /(dev-smoke|collab-latency|auth-flow)\.spec\.ts/,
  // Warms the served bundles. See the file for why.
  globalSetup: "./e2e/global-setup.ts",
  // Serial: every spec shares one IndexedDB origin and one server, so parallel
  // workers would stomp on each other's boards.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  outputDir: "test-results",
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
      // Serves the pre-built output only. Building is a separate step (the root
      // `yarn e2e` script runs `build:all` first) so that a build crash is
      // reported as a build failure with a clear signal, instead of surfacing
      // as a webServer that never became ready.
      command: "node e2e/preview-server.mjs",
      url: `http://localhost:${PORT}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        PORT: String(PORT),
        EDITOR_BASE,
        DASHBOARD_DIST: "./dist",
        EDITOR_BUILD: "../excalidraw-app/build",
      },
    },
  ],
});
