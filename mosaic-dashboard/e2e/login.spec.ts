import { expect, test } from "@playwright/test";

import {
  blockExternalRequests,
  createBoard,
  resetLocalData,
  waitForDashboard,
} from "./helpers";

/**
 * Accounts do not obstruct the anonymous flow (STEP 3).
 *
 * The build served to this suite is the e2e build, which leaves `VITE_API_URL`
 * unset so storage falls back to IndexedDB and no serverless function is ever
 * contacted. That is deliberate: it keeps the suite hermetic, and it is also the
 * exact configuration a signed-out visitor gets.
 *
 * So this spec asserts the property that actually matters at this step — accounts
 * are additive and never in the way. A build with no API must show no Sign in link
 * at all, must still create and read boards, and must still let a visitor reach
 * /login, which then says plainly that accounts are unavailable rather than
 * offering a form that cannot work.
 *
 * The full magic-link journey against a live API, with Resend mocked, is
 * `auth-flow.spec.ts` in STEP 6.
 */

test.describe("Accounts do not obstruct the anonymous flow", () => {
  test.beforeEach(async ({ page }) => {
    await blockExternalRequests(page);
    await resetLocalData(page);
  });

  test("a visitor with no server is never asked to sign in", async ({ page }) => {
    await waitForDashboard(page);

    await expect(page.getByTestId("nav-all-boards")).toBeVisible();

    // Nothing in the chrome suggests signing in, because there is nothing to sign
    // in to. Rendering the link anyway would be a dead end.
    await expect(page.getByTestId("sign-in-link")).toHaveCount(0);
    await expect(page.getByTestId("account-signed-in")).toHaveCount(0);
  });

  test("boards still work end to end while signed out", async ({ page }) => {
    await createBoard(page);
    await expect(page.getByTestId("board-count")).toContainText("1 board");

    // Reload: the whole local-first promise is that the data survives without any
    // account, which is exactly what an unconfigured build has to keep doing.
    await page.reload();
    await waitForDashboard(page);
    await expect(page.getByTestId("board-count")).toContainText("1 board");
  });

  test("/login is reachable and explains itself instead of failing", async ({
    page,
  }) => {
    await page.goto("/login");

    await expect(page.getByTestId("login-page")).toBeVisible();
    // No email input, because submitting one could not possibly work here.
    await expect(page.getByTestId("login-email")).toHaveCount(0);
    await expect(page.getByTestId("login-page")).toContainText("no server");
  });

  test("/login does not hijack any other route", async ({ page }) => {
    // The catch-all in App.tsx redirects unknown paths to /dashboard, so /login
    // must not become a redirect target for ordinary navigation.
    await page.goto("/dashboard/trash");
    await waitForDashboard(page);
    await expect(page.getByTestId("trash-header")).toBeVisible();
    await expect(page.getByTestId("login-page")).toHaveCount(0);
  });
});