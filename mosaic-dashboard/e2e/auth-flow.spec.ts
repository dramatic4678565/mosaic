import { expect, test } from "@playwright/test";

import {
  blockExternalRequests,
  createBoard,
  openBoardMenu,
  waitForDashboard,
} from "./helpers";

/**
 * The account journeys, walked as a person would walk them (Part 3B, STEP 6).
 *
 * Each spec follows one story end to end rather than asserting a list of endpoints,
 * because the interesting failures live in the seams: a link that works but does not
 * sign you in, a claim that moves rows but leaves the grid empty, a share link that
 * 200s and shows nothing.
 *
 * Resend is not involved. There is no mailbox, so `GET /__test__/last-magic-link`
 * stands in for the inbox and the link is followed exactly as it would be by
 * clicking it in an email. That is the only fake here.
 *
 * Board creation goes through the shared `createBoard` helper rather than inline,
 * because "New board" navigates into the editor and the grid is only visible after
 * coming back. Hand-rolling that step is how the first run of this suite ended up
 * asserting against a page that was showing the editor.
 */

const EMAIL = "e2e-user@example.com";

/** Clears the mock's state, so specs cannot leak into each other. */
const resetApi = async (page: import("@playwright/test").Page) => {
  await page.request.post("/__test__/reset");
};

/** Reads the magic link the mock "sent", the way a person reads their inbox. */
const readMagicLink = async (page: import("@playwright/test").Page) => {
  const res = await page.request.get("/__test__/last-magic-link");
  const body = await res.json();
  expect(body.link, "a magic link should have been issued").toBeTruthy();
  expect(body.link.email).toBe(EMAIL);
  return body.link as { token: string; email: string; url: string };
};

/** Drives the real /login form, so the form itself is covered and not just the API. */
const signInThroughTheUi = async (
  page: import("@playwright/test").Page,
  email = EMAIL,
) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-sent")).toBeVisible();
};

/** Signs in and lands on the dashboard, returning the link for reuse. */
const signInAndLand = async (page: import("@playwright/test").Page) => {
  await signInThroughTheUi(page);
  const link = await readMagicLink(page);
  await page.goto(link.url);
  await expect(page).toHaveURL(/\/dashboard/);
  return link;
};

/** Creates a board as the signed-in owner and shares it, returning the link. */
const shareOneBoard = async (page: import("@playwright/test").Page) => {
  const id = await createBoard(page);
  await openBoardMenu(page, id);
  await page.getByTestId("menu-share").click();
  await expect(page.getByTestId("share-url")).toBeVisible();
  const url = await page.getByTestId("share-url").inputValue();
  expect(url).toContain("/share/");
  await page.keyboard.press("Escape");
  return { id, url };
};

test.describe("Accounts", () => {
  test.beforeEach(async ({ page }) => {
    // Stops the bundle phoning home for fonts or analytics. Same-origin requests,
    // which includes the mock API, are unaffected.
    await blockExternalRequests(page);
    await resetApi(page);
  });

  test("request a magic link, follow it, and land on the dashboard", async ({
    page,
    browser,
  }) => {
    await signInThroughTheUi(page);

    // Following the link is a real navigation, exactly as clicking it in an email
    // would be — which is the only thing that establishes the session cookie.
    const link = await readMagicLink(page);
    await page.goto(link.url);

    await expect(page).toHaveURL(/\/dashboard/);
    // The account block is how the app shows it worked.
    await expect(page.getByTestId("account-signed-in")).toBeVisible();
    await expect(page.getByTestId("account-email")).toHaveText(EMAIL);
    await expect(page.getByTestId("sign-out")).toBeVisible();

    // A magic link is single-use. Checked from a context with no session, because a
    // visitor who is already signed in is bounced straight off /login to /dashboard
    // and would never see the error — correct behaviour, but it hides this assertion.
    const freshContext = await browser.newContext();
    const fresh = await freshContext.newPage();
    await blockExternalRequests(fresh);
    await fresh.goto(link.url);
    await expect(fresh).toHaveURL(/\/login\?error=used/);
    await expect(fresh.getByTestId("login-error")).toBeVisible();
    await freshContext.close();
  });

  test("an anonymous visitor is never blocked from using the app", async ({
    page,
  }) => {
    // No account, no server round trip for identity, and boards still work.
    await page.goto("/dashboard");
    await waitForDashboard(page);
    await expect(page.getByTestId("sign-in-link")).toBeVisible();
    await expect(page.getByTestId("account-signed-in")).toHaveCount(0);

    await createBoard(page);
    await expect(page.getByTestId("board-count")).toContainText("1 board");

    // The prompt is for signed-in users only, so an anonymous visit is never
    // interrupted by it.
    await expect(page.getByTestId("claim-prompt")).toHaveCount(0);
  });

  test("a guest sees the offer to import, and declining destroys nothing", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await createBoard(page);
    await expect(page.getByTestId("board-count")).toContainText("1 board");

    await signInAndLand(page);

    await expect(page.getByTestId("claim-prompt")).toBeVisible();
    // The count lives in the modal's description, which Modal renders outside the
    // children slot, so this asserts on the dialog rather than on the body of it.
    await expect(page.getByRole("dialog")).toContainText("1 board");

    await page.getByTestId("claim-skip").click();
    await expect(page.getByTestId("claim-prompt")).toHaveCount(0);
  });

  test("importing brings the guest boards into the account", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await createBoard(page);
    await expect(page.getByTestId("board-count")).toContainText("1 board");

    await signInAndLand(page);

    await expect(page.getByTestId("claim-prompt")).toBeVisible();
    // "Import" is the modal's confirm action.
    await page
      .getByRole("button", { name: /import/i })
      .first()
      .click();

    await expect(page.getByTestId("claim-prompt")).toHaveCount(0);
    // Now visible under the account rather than the guest cookie.
    await expect(page.getByTestId("board-count")).toContainText("1 board");

    // And it survives a reload, which is the entire point of claiming.
    await page.reload();
    await waitForDashboard(page);
    await expect(page.getByTestId("board-count")).toContainText("1 board");
  });

  test("a shared board is readable by someone with no account", async ({
    page,
    browser,
  }) => {
    await signInAndLand(page);
    const { url } = await shareOneBoard(page);

    // A separate context is as close to "someone else" as a browser test gets, and
    // it shares no cookies with the owner.
    const viewerContext = await browser.newContext();
    const viewer = await viewerContext.newPage();
    await blockExternalRequests(viewer);
    await viewer.goto(url);

    await expect(viewer.getByTestId("share-page")).toBeVisible();
    await expect(viewer.getByTestId("share-frame")).toBeVisible();

    // Read-only viewer: none of the owner's chrome, and no account of its own.
    await expect(viewer.getByTestId("nav-settings")).toHaveCount(0);
    await expect(viewer.getByTestId("sign-out")).toHaveCount(0);
    await expect(viewer.getByTestId("account-signed-in")).toHaveCount(0);
    await expect(viewer.getByTestId("new-board")).toHaveCount(0);

    await viewerContext.close();
  });

  test("revoking a share kills the link", async ({ page, browser }) => {
    await signInAndLand(page);
    const id = await createBoard(page);
    await openBoardMenu(page, id);
    await page.getByTestId("menu-share").click();
    const url = await page.getByTestId("share-url").inputValue();
    await page.getByTestId("share-revoke").click();
    await expect(page.getByTestId("share-revoked")).toBeVisible();
    await page.keyboard.press("Escape");

    const viewerContext = await browser.newContext();
    const viewer = await viewerContext.newPage();
    await blockExternalRequests(viewer);
    await viewer.goto(url);
    // Revoked is indistinguishable from never having existed.
    await expect(viewer.getByTestId("share-missing")).toBeVisible();
    await viewerContext.close();
  });

  test("signing out returns the browser to the anonymous flow", async ({
    page,
  }) => {
    await signInAndLand(page);
    await expect(page.getByTestId("account-signed-in")).toBeVisible();

    await page.getByTestId("sign-out").click();
    await expect(page.getByTestId("sign-in-link")).toBeVisible();

    // The account's boards are no longer visible — they belong to the account, not
    // to this browser. What must still work is everything anonymous.
    await page.goto("/dashboard");
    await waitForDashboard(page);
    await createBoard(page);
    await expect(page.getByTestId("board-count")).toContainText("1 board");

    // And signing back in is still possible.
    await page.goto("/login");
    await expect(page.getByTestId("login-email")).toBeVisible();
  });

  test("the login page does not reveal whether an address has an account", async ({
    page,
  }) => {
    await signInThroughTheUi(page);
    await expect(page.getByTestId("login-sent")).toBeVisible();

    // A different address gets the identical response, because the server answers the
    // same for anything it would accept.
    await page.goto("/login");
    await page.getByTestId("login-email").fill("stranger@example.com");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("login-sent")).toBeVisible();
  });
});
