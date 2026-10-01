import { expect, test } from "@playwright/test";

import {
  createBoard,
  blockExternalRequests,
  resetLocalData,
  visibleText,
  expectNoBrandLeak,
  waitForDashboard,
} from "./helpers";

/**
 * Rebrand audit (STEP 5).
 *
 * Asserts that no user-visible surface says "Excalidraw" any more.
 *
 * The check reads *rendered text and accessible names*, not raw HTML, because
 * the codebase legitimately still contains the token in places a user never
 * sees: ~200 CSS classes (`ExcalidrawLogo`, `excalidraw-ui-top-left`), data
 * attributes, the `window.EXCALIDRAW_ASSET_PATH` global, IndexedDB keys, the
 * `@excalidraw/*` package names and the MIT attribution. Flagging those would
 * make the audit useless — it would fail on a correct codebase, so it would get
 * switched off.
 *
 * What must be zero: the string "Excalidraw" in rendered text or an
 * aria-label/title, anywhere in the dashboard, and in the editor apart from the
 * documented allow-list below.
 */
test.describe("Rebrand audit", () => {
  test.beforeEach(async ({ page }) => {
    await blockExternalRequests(page);
    await resetLocalData(page);
  });

  /**
   * Dashboard routes: strict. The dashboard is new code with no legacy, so any
   * "Excalidraw" on it is a genuine leak.
   */
  const DASHBOARD_ROUTES = [
    { path: "/dashboard", label: "All boards" },
    { path: "/dashboard/favorites", label: "Favorites" },
    { path: "/dashboard/trash", label: "Trash" },
    { path: "/dashboard/activity", label: "Activity" },
    { path: "/dashboard/settings", label: "Settings" },
  ];

  for (const route of DASHBOARD_ROUTES) {
    test(`dashboard route "${route.path}" shows no Excalidraw`, async ({
      page,
    }) => {
      await page.goto(route.path);
      await waitForDashboard(page);
      await expectNoBrandLeak(page, page.locator("body"), {
        label: `dashboard ${route.path}`,
      });
      // And it should actually say "Mosaic".
      await expect(page.locator("body")).toContainText("Mosaic");
    });
  }

  test("a folder view shows no Excalidraw", async ({ page }) => {
    const id = await createBoard(page);
    // Create a folder and file the board so the route is non-empty.
    await page.getByTestId("new-folder").click();
    await page.getByTestId("folder-name-input").fill("Team");
    await page.getByTestId("folder-name-input").press("Enter");
    await expect(page.locator("[data-folder-id]").first()).toBeVisible();
    const folderId = await page
      .locator("[data-folder-id]")
      .first()
      .getAttribute("data-folder-id");

    await page.goto(`/dashboard/folders/${folderId}`);
    await waitForDashboard(page);
    await expectNoBrandLeak(page, page.locator("body"), {
      label: "dashboard folder view",
    });
    expect(id).toBeTruthy();
  });

  /**
   * Editor, board mode: allow-listed.
   *
   * These are deliberate, not oversights. Full reasoning in REBRAND.md §D and
   * memory/REFERENCE.md.
   */
  test("editor in board mode shows no Excalidraw outside the allow-list", async ({
    page,
  }) => {
    const id = await createBoard(page);
    await page.getByTestId(`board-card-${id}`).click();
    await page.waitForURL(`**/board/${id}`);

    const frame = page.frameLocator('[data-testid="editor-frame"]');
    // Wait for the editor to actually render before auditing it, otherwise this
    // would trivially pass on a blank frame.
    const canvas = frame.locator("canvas.excalidraw__canvas.interactive");
    await canvas.waitFor({ state: "attached", timeout: 90_000 });

    // The visible editor chrome (menu, welcome screen, dialogs) must be clean.
    // Allow-list rationale:
    //  - "Excalidraw+"        a separate live paid product we do not own
    //  - "Powered by Excalidraw"  the MIT attribution credit, intentionally kept
    //  - "Excalidraw" in an aria-label only where it names the *component*
    //    being embedded, which is developer-facing a11y text
    await expectNoBrandLeak(page, frame.locator("body"), {
      label: "editor board mode",
      allow: [
        "Excalidraw+",
        "Powered by Excalidraw",
        'Add "Excalidraw" to exported files as a watermark',
      ],
    });
  });

  test("the MIT attribution credit is still reachable", async ({ page }) => {
    // Hard requirement from Part 1: the upstream notice must remain. This test
    // is the guard that it does not get "cleaned up" by a future audit.
    const id = await createBoard(page);
    await page.getByTestId(`board-card-${id}`).click();
    await page.waitForURL(`**/board/${id}`);

    const frame = page.frameLocator('[data-testid="editor-frame"]');
    const canvas = frame.locator("canvas.excalidraw__canvas.interactive");
    await canvas.waitFor({ state: "attached", timeout: 90_000 });

    const html = await frame.locator("body").innerHTML();
    // Either the credit link is present, or the LICENSE/NOTICE reference is.
    const hasCredit =
      html.includes("Powered by Excalidraw") || html.includes("excalidraw.com");
    expect(
      hasCredit,
      "MIT attribution must remain reachable from the editor",
    ).toBe(true);
  });

  test("the editor's own page title is Mosaic", async ({ page }) => {
    // Served directly by the proxy, outside the dashboard.
    await page.goto("/editor/");
    await expect(page).toHaveTitle(/Mosaic/);
    // And the meta description.
    const description = await page
      .locator('meta[name="description"]')
      .getAttribute("content");
    expect(description).toContain("Mosaic");
    expect(description).not.toContain("Excalidraw");
  });

  test("the dashboard's own page title is Mosaic", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveTitle(/Mosaic/);
  });

  test("renders the Mosaic wordmark in the sidebar", async ({ page }) => {
    await page.goto("/dashboard");
    await waitForDashboard(page);
    const text = await visibleText(page.locator("body"));
    expect(text).toContain("Mosaic");
    // The brand mark is the 2x2 tile grid.
    await expect(page.locator('svg[aria-label="Mosaic"]')).toBeVisible();
  });
});
