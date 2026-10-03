import { defineConfig, devices } from "@playwright/test";

/**
 * Dev-server smoke suite.
 *
 * Deliberately separate from `playwright.config.ts`. That config *builds* both
 * apps and serves the bundles through `e2e/preview-server.mjs`, which is the
 * right thing for the shipped artifact but cannot see the developer-facing
 * wiring: the dev-server proxying, the `/editor` mount, or the single-command
 * `yarn start`.
 *
 * So this config assumes `yarn start` is already running (editor on :3000,
 * dashboard on :3002) and simply drives a browser at it.
 *
 * Run: yarn --cwd mosaic-dashboard test:e2e:dev
 */
// Playwright's `use.env` injects variables into the *browser*, not into the Node
// process that runs the spec, so a spec reading `process.env` would never see it.
// Setting it here works because this config is evaluated in the main process
// before the workers are forked, and workers inherit `process.env`.
process.env.MOSAIC_E2E_EDITOR_URL = "http://localhost:3000/editor/";

export default defineConfig({
  testDir: "./e2e",
  /**
   * Both specs run here.
   *
   * `dev-smoke.spec.ts` is dev-only by definition. `menu-hide.spec.ts` runs in
   * this suite too, against the dev server, so the menu hiding is checked in
   * both places - see the note in playwright.config.ts for the built-output run.
   */
  testMatch: /(dev-smoke|menu-hide)\.spec\.ts/,
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  outputDir: "test-results-dev",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1280, height: 800 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
