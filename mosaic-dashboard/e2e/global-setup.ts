import { chromium } from "@playwright/test";

/**
 * Warm-up.
 *
 * Both apps are served pre-built (see playwright.config.ts), so there is no dev
 * server transform cost to amortise. What this does is walk the exact path the
 * specs take — dashboard -> create a board -> editor inside an iframe — so the
 * first spec is not also the one paying for a cold HTTP cache, a cold Chromium
 * profile, the initial service-worker registration, and the editor's font
 * preload (which hits an upstream CDN and can be slow or blocked).
 *
 * Visiting `/editor/` directly is not enough: the iframe path differs, and it
 * is the iframe path every editor spec uses.
 *
 * Non-fatal by design: a genuine outage should fail every spec with a useful
 * error pointing at the page, not crash during setup.
 */
const DASHBOARD_URL =
  process.env.MOSAIC_E2E_DASHBOARD_URL ?? "http://localhost:3101";
const EDITOR_URL =
  process.env.MOSAIC_E2E_EDITOR_URL ?? "http://localhost:3101/editor/";
const TIMEOUT_MS = 120_000;

export default async function globalSetup(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log("[global-setup] warming both bundles…");

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();

    // 1. The editor on its own, so its bundle graph is resolved.
    await page.goto(EDITOR_URL, { timeout: TIMEOUT_MS });
    await page.waitForSelector("canvas.excalidraw__canvas", {
      state: "attached",
      timeout: TIMEOUT_MS,
    });

    // 2. The dashboard, then a board opened through the iframe — the path the
    //    specs actually exercise.
    await page.goto(DASHBOARD_URL, { timeout: TIMEOUT_MS });
    await page.waitForSelector('[data-testid="new-board"]', {
      state: "attached",
      timeout: TIMEOUT_MS,
    });

    await page.getByTestId("new-board").click();
    await page.waitForURL(/\/board\/.+/, { timeout: TIMEOUT_MS });
    await page
      .frameLocator('[data-testid="editor-frame"]')
      .locator("canvas.excalidraw__canvas.interactive")
      .waitFor({ state: "attached", timeout: TIMEOUT_MS });

    // eslint-disable-next-line no-console
    console.log("[global-setup] editor and dashboard are warm");
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(
      `[global-setup] warm-up did not complete (${String(error)}). ` +
        "Continuing; specs may be slower to start.",
    );
  } finally {
    await browser.close();
  }
}
