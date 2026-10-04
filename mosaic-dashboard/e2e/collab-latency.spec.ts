import { test, expect } from "@playwright/test";

/**
 * Measures real collaboration latency against the live room server.
 *
 * This walks the actual user flow rather than fabricating a URL:
 * client A starts a session from the welcome screen, types a name, and the
 * generated `#room=<id>,<key>` link is opened in a second browser context.
 * Fabricating `#room=<id>` without a key does not join anything — the editor
 * treats a keyless room link as "no session" and never opens a socket.
 *
 * The measured number is between "rectangle created in A" and "rectangle present
 * in B's scene", which is what a user perceives.
 *
 * Runs against a real server because latency is the entire bug being fixed; a
 * stub would only prove the wiring. Kept out of `yarn e2e` because it needs
 * outbound network and a live server, which a hermetic build-and-serve suite
 * must not require.
 *
 * Run: yarn test:e2e:collab
 */
const LIVE_ROOM_SERVER =
  process.env.MOSAIC_COLLAB_E2E_SERVER ??
  "https://excalidraw-room-5yet.onrender.com";

/** Where our built editor is served from (see playwright.collab.config.ts). */
const APP_ORIGIN = process.env.MOSAIC_COLLAB_E2E_APP ?? "http://localhost:3101";

/**
 * Waits until a client has joined a room.
 *
 * `collab-button` is upstream's own test id on the live-collaboration trigger
 * and gains `highlighted` once `isCollaborating` is true. Waiting for that rather
 * than sleeping keeps the measurement about steady-state sync rather than about
 * room join.
 */
const waitForCollaboration = async (
  page: import("@playwright/test").Page,
  label: string,
) => {
  await expect(
    page.locator("canvas.excalidraw__canvas.interactive"),
    `client ${label} canvas`,
  ).toBeVisible({ timeout: 120_000 });
  await expect(
    page
      .getByTestId("collab-button")
      .locator(".highlighted, .dropdown-menu-item__highlighted"),
    `client ${label} joined a room`,
  ).toBeVisible({ timeout: 120_000 });
};

/**
 * Starts a session and returns the shareable room URL.
 *
 * The dialog has no "Start collaborating" button: typing a name and pressing
 * Enter (or closing it) is what joins, and the generated room link is exposed in
 * a read-only "Link" field. Reading that field is more robust than parsing the
 * address bar, because the URL is updated asynchronously.
 */
const startSession = async (
  page: import("@playwright/test").Page,
  name: string,
) => {
  // The welcome screen's "Live collaboration..." entry.
  await page
    .getByRole("button", { name: /live collaboration/i })
    .first()
    .click();

  const nameField = page.getByPlaceholder("Your name");
  await expect(nameField).toBeVisible({ timeout: 60_000 });
  await nameField.fill(name);
  await nameField.press("Enter");

  // The read-only field holding the shareable link.
  const linkField = page.locator(
    'input[readonly][value*="#room="], input.ShareDialog__active__linkRow input',
  );
  await expect
    .poll(
      async () =>
        (await linkField
          .first()
          .inputValue()
          .catch(() => "")) || "",
      { timeout: 60_000, message: "room link should be generated" },
    )
    .toContain("#room=");

  return (await linkField.first().inputValue()).trim();
};

test("a rectangle reaches a second client in well under a second", async ({
  browser,
}) => {
  test.setTimeout(300_000);

  // Render's free tier sleeps when idle, so the first request can take ~30s to
  // cold-start. This wait is deliberately *not* part of the measured latency; it
  // only wakes the instance so the number below is steady-state.
  await test.step("wake the room server", async () => {
    const deadline = Date.now() + 120_000;
    for (;;) {
      try {
        const res = await fetch(LIVE_ROOM_SERVER, {
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) {
          break;
        }
      } catch {
        /* cold start: retry */
      }
      if (Date.now() > deadline) {
        throw new Error(`room server never became ready: ${LIVE_ROOM_SERVER}`);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  });

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  try {
    await a.goto(`${APP_ORIGIN}/editor/`);
    await expect(
      a.locator("canvas.excalidraw__canvas.interactive"),
      "client A canvas",
    ).toBeVisible({ timeout: 120_000 });

    // A creates the room; its URL now carries a valid roomId,roomKey.
    const roomUrl = await startSession(a, "Latency A");
    await b.goto(roomUrl);

    await waitForCollaboration(a, "A");
    await waitForCollaboration(b, "B");

    // Let the initial SCENE_INIT exchange settle so we time steady-state sync
    // rather than room join.
    await a.waitForTimeout(3000);

    const elementCount = (page: import("@playwright/test").Page) =>
      page.evaluate(() => {
        const api = (window as any).excalidrawAPI;
        return api ? api.getSceneElements().length : -1;
      });

    const baseline = await elementCount(b);

    const startedAt = Date.now();
    const canvas = a.locator("canvas.excalidraw__canvas.interactive");
    const box = (await canvas.boundingBox())!;
    await a.keyboard.press("r");
    await a.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2 - 60);
    await a.mouse.down();
    await a.mouse.move(
      box.x + box.width / 2 + 80,
      box.y + box.height / 2 + 60,
      {
        steps: 10,
      },
    );
    await a.mouse.up();

    await expect
      .poll(() => elementCount(b), {
        timeout: 30_000,
        message: "client B should receive the rectangle",
      })
      .toBeGreaterThan(baseline);

    const latencyMs = Date.now() - startedAt;
    // eslint-disable-next-line no-console
    console.log(
      `\n[collab] rectangle visible in the second client after ${latencyMs}ms\n`,
    );

    expect(latencyMs).toBeLessThan(1000);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
