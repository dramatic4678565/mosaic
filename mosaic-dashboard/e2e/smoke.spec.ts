import { expect, test } from "@playwright/test";

/**
 * End-to-end smoke test (STEP 8).
 *
 * Walks the whole product loop in one test on purpose:
 * create → rename → favorite → move to folder → open editor → draw → save →
 * back to dashboard → thumbnail visible → trash → restore.
 *
 * Keeping it as a single flow means a broken hand-off between the dashboard and
 * the editor (the IndexedDB bridge) fails loudly here rather than passing as two
 * independently-green halves.
 *
 * Data isolation: each test starts by clearing the dashboard's IndexedDB through
 * the app's own reset path, so runs are repeatable and do not depend on residue
 * from a previous run.
 */

const resetLocalData = async (page: import("@playwright/test").Page) => {
  await page.goto("/dashboard");
  await page.waitForSelector(
    '[data-testid="board-grid"], [data-testid="empty-state"]',
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase("mosaic-dashboard");
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      }),
  );
  await page.reload();
};

/**
 * Opens a board's "..." menu.
 *
 * The button is revealed by a CSS `:hover` rule on the card, so it exists in the
 * DOM but is not visible until the card is hovered. Playwright's actionability
 * check would otherwise time out on a genuinely clickable element.
 */
const openBoardMenu = async (
  page: import("@playwright/test").Page,
  boardId: string,
) => {
  const menu = page.getByTestId(`menu-${boardId}`);
  // The card is a dnd-kit draggable, so hovering it can leave a CSS transform
  // mid-transition and Playwright's "stable" check never settles. The button
  // itself is always visible (not hover-revealed), so forcing the click is
  // safe here — unlike a display:none control, this dispatches onto the real
  // button rather than onto whatever sits underneath it.
  await page.locator(`[data-testid="board-card-${boardId}"]`).hover();
  await menu.click({ force: true, timeout: 15_000 });
};

/**
 * Reads the single folder id from the sidebar.
 *
 * Selects on `[data-folder-id]` rather than a `folder-*` test-id prefix: the
 * sidebar's "new folder" input also starts with `folder-` and would match a
 * naive prefix selector.
 */
const getFolderId = async (page: import("@playwright/test").Page) => {
  const row = page.locator("[data-folder-id]").first();
  await expect(row).toBeVisible();
  return (await row.getAttribute("data-folder-id"))!;
};

test.describe("Mosaic dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await resetLocalData(page);
  });

  test("full board lifecycle", async ({ page }) => {
    // ---- create a board -----------------------------------------------------
    await page.getByTestId("new-board").click();
    // Creating a board navigates straight to the editor; come back.
    await page.getByTestId("back-to-dashboard").click();
    await expect(page.getByTestId("board-grid")).toBeVisible();
    await expect(page.getByTestId("board-count")).toContainText("1 board");

    // Capture the generated board id from the first card's test id.
    const firstCard = page.locator('[data-testid^="board-card-"]').first();
    await expect(firstCard).toBeVisible();
    const boardId = (await firstCard.getAttribute("data-testid"))!.replace(
      "board-card-",
      "",
    );

    // ---- rename (inline, via context menu to reach it deterministically) ----
    await openBoardMenu(page, boardId);
    await page.getByTestId("menu-rename").click();
    const renameInput = page.getByTestId(`rename-input-${boardId}`);
    await expect(renameInput).toBeVisible();
    await renameInput.fill("Sprint Planning");
    await renameInput.press("Enter");
    await expect(page.getByTestId(`board-name-${boardId}`)).toHaveText(
      "Sprint Planning",
    );

    // ---- favorite ----------------------------------------------------------
    await page.getByTestId(`star-${boardId}`).click();
    await expect(page.getByTestId(`star-${boardId}`)).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Favorites view shows it.
    await page.getByTestId("nav-favorites").click();
    await expect(page.getByTestId(`board-card-${boardId}`)).toBeVisible();
    await page.getByTestId("nav-all-boards").click();

    // ---- move to folder ----------------------------------------------------
    await page.getByTestId("new-folder").click();
    await page.getByTestId("folder-name-input").fill("Team");
    await page.getByTestId("folder-name-input").press("Enter");
    const folderId = await getFolderId(page);

    await openBoardMenu(page, boardId);
    await page.getByTestId("menu-move-toggle").click();
    await page.getByTestId(`menu-move-${folderId}`).click();
    // "All boards" intentionally lists every board regardless of folder, so
    // the meaningful assertion is the folder view: the board is now filed there.
    // The folder counter in the sidebar confirms it too.
    await page.getByTestId(`folder-${folderId}`).click();
    await expect(page.getByTestId(`board-card-${boardId}`)).toBeVisible();
    // The sidebar row shows a board count in its trailing span.
    await expect(
      page.getByTestId(`folder-${folderId}`).locator("span").last(),
    ).toHaveText("1");
    await page.getByTestId("nav-all-boards").click();
    await expect(page.getByTestId(`board-card-${boardId}`)).toBeVisible();

    // ---- open editor, draw, save ------------------------------------------
    await page.getByTestId(`board-card-${boardId}`).click();
    await page.waitForURL(`**/board/${boardId}`);
    const frame = page.frameLocator('[data-testid="editor-frame"]');
    // Wait for the editor canvas to be attached and laid out. `state: "visible"`
    // alone can be flaky because the canvas is sized by CSS after the editor
    // measures the iframe, so wait for attachment first, then poll for a
    // non-zero bounding box.
    // Two canvases share this class: a static (rendered scene) layer and an
    // interactive (event handling) layer. Both are stacked; the interactive one
    // is the top layer and is what receives pointer events, so target it.
    const canvas = frame.locator("canvas.excalidraw__canvas.interactive");
    // The editor is a large app served by a cold dev server, so first paint can
    // take a while. Wait generously for attachment, then poll for layout.
    await canvas.waitFor({ state: "attached", timeout: 90_000 });
    await expect
      .poll(
        async () => {
          const box = await canvas.boundingBox();
          return box ? Math.round(box.width) : 0;
        },
        {
          timeout: 60_000,
          message: "editor canvas should get a layout box",
        },
      )
      .toBeGreaterThan(0);

    // Draw a rectangle. The rectangle tool is selected with its keyboard
    // shortcut ("r") rather than by clicking a toolbar button: the shape tools
    // are rendered from a dynamic list and have no stable data-testid, so a
    // shortcut is both stable and closer to how a user actually draws.
    await frame.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("r");

    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + 120, box.y + 120);
    await page.mouse.down();
    await page.mouse.move(box.x + 320, box.y + 260, { steps: 12 });
    await page.mouse.up();

    // Force an immediate save via Ctrl+S (board mode intercepts it).
    await frame.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+s");
    // Wait for the save-status indicator the dashboard renders on save.
    await expect(page.getByTestId("save-status")).toBeVisible({
      timeout: 20_000,
    });

    // ---- back to dashboard: thumbnail is now visible -----------------------
    await page.getByTestId("back-to-dashboard").click();
    await page.getByTestId("nav-all-boards").click();
    const thumb = page.getByTestId(`board-thumb-${boardId}`);
    await expect(thumb).toBeVisible({ timeout: 20_000 });

    // ---- trash + restore ---------------------------------------------------
    await openBoardMenu(page, boardId);
    await page.getByTestId("menu-trash").click();
    await expect(page.getByTestId(`board-card-${boardId}`)).toHaveCount(0);

    await page.getByTestId("nav-trash").click();
    await expect(page.getByTestId(`board-card-${boardId}`)).toBeVisible();
    await openBoardMenu(page, boardId);
    await page.getByTestId("menu-restore").click();

    // Back in all-boards, the board is live again.
    await page.getByTestId("nav-all-boards").click();
    await expect(page.getByTestId(`board-card-${boardId}`)).toBeVisible();
    await expect(page.getByTestId(`board-name-${boardId}`)).toHaveText(
      "Sprint Planning",
    );
  });
});
