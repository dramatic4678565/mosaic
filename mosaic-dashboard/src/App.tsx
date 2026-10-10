import { useEffect } from "react";
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
} from "react-router-dom";

import { storage } from "@/lib/storage";
import { ActivityPage } from "@/pages/ActivityPage";
import { BoardPage } from "@/pages/BoardPage";
import { BoardsPage } from "@/pages/BoardsPage";
import { LoginPage } from "@/pages/LoginPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { SharedBoardPage } from "@/pages/SharedBoardPage";
import { useAuthStore } from "@/state/useAuthStore";
import { useDashboardStore } from "@/state/useDashboardStore";
import { AppShell } from "@/components/shell/AppShell";
import { ClaimGuestDataPrompt } from "@/components/auth/ClaimGuestDataPrompt";

/**
 * Base path the dashboard is mounted at.
 *
 * In production the dashboard is served from `/dashboard/` by the same nginx that
 * serves the editor, so React Router needs a basename. In dev Vite serves it from
 * `/`, hence the env-driven default. Keeping this in one place avoids the
 * classic bug where links work in dev and 404 in prod.
 *
 * The router basename is a *separate* concern from the asset base, and it
 * defaults to "" on purpose.
 *
 * `base` controls where Vite emits asset URLs. `basename` controls how
 * react-router interprets the path it sees. They only need to differ when the
 * app is mounted on a sub-path that is *not* itself part of the route table —
 * which is exactly the local-dev setup: the editor's dev server proxies
 * `/dashboard` here, the app is served from `/dashboard/` so its asset URLs
 * resolve, but the routes are still `/dashboard`, `/dashboard/trash`, …
 *
 * Deriving the basename from `base` double-counts the prefix in that case and
 * turns `/dashboard/trash` into `/dashboard/dashboard/trash`. Production sets
 * `base=/`, which reduced to an empty basename anyway, so defaulting to "" is
 * identical to the previous behaviour there.
 */
const BASENAME = import.meta.env.MOSAIC_DASHBOARD_BASENAME ?? "";

/**
 * Layout route for everything that wants the two-column shell.
 *
 * The sidebar, the account block and the board grid all assume an owner with an
 * editable store, so a read-only shared-board viewer must not be inside them.
 * Routing the shell through a layout keeps that boundary in one place instead of
 * duplicated per route.
 */
const ShellLayout = () => (
  <AppShell>
    <Outlet />
  </AppShell>
);

export const App = () => {
  const loadState = useDashboardStore((s) => s.loadState);
  const reload = useDashboardStore((s) => s.reload);
  const refreshAuth = useAuthStore((s) => s.refresh);

  /**
   * Boot sequence:
   * 1. purge expired trash (STEP 7) before the first read, so the grid never
   *    renders a board that is about to disappear
   * 2. load boards / folders / activity
   * 3. read the session, so the sidebar shows the right account state
   *
   * Both are idempotent, so a React 18 StrictMode double-invoke in dev is safe.
   *
   * The three are independent. In particular a failure to read the session must not
   * stop the board load: a signed-out visitor is the normal case, and the app is
   * fully usable that way. Step 3 is therefore started without awaiting it.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await storage.purgeExpiredTrash();
      } catch (error) {
        // A purge failure must not block the dashboard: worst case a stale board
        // lingers in trash until the next boot.
        console.warn("Trash purge failed", error);
      }
      if (!cancelled) {
        await reload();
      }
    })();

    void refreshAuth();

    return () => {
      cancelled = true;
    };
  }, [reload, refreshAuth]);

  return (
    <BrowserRouter basename={BASENAME}>
      {/*
        ONE route table, not two.

        A shared board must render without the shell, and the obvious way to do that
        is a second sibling `<Routes>`. That does not work: each `<Routes>` matches
        independently, so the `*` catch-all below also matched `/share/:token`,
        navigated to /dashboard, and won the race. The viewer silently landed on the
        dashboard — which is what the first run of this suite showed.

        A layout route is the correct shape: the shell wraps the routes that want it,
        and the one route that does not sits beside them.
      */}
      <Routes>
        {/**
         * The board editor and the shared viewer sit beside the shell, not inside
         * it. Both render an iframe that needs the whole viewport: inside the shell
         * they lost 248px to the sidebar plus the shell's padding, and a flex chain
         * that resolves to zero makes Excalidraw size its canvas to zero permanently.
         *
         * This is the same reasoning as the shared board above, and it is why this
         * is one route table rather than two: a second sibling `<Routes>` would let
         * the `*` catch-all match these paths and win the race.
         */}
        <Route path="/share/:token" element={<SharedBoardPage />} />
        <Route path="/board/:id" element={<BoardPage />} />
        <Route element={<ShellLayout />}>
          {/* STEP 2 route table */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<BoardsPage />} />
          <Route path="/dashboard/favorites" element={<BoardsPage />} />
          <Route path="/dashboard/folders/:folderId" element={<BoardsPage />} />
          <Route path="/dashboard/trash" element={<BoardsPage />} />
          <Route path="/dashboard/activity" element={<ActivityPage />} />
          <Route path="/dashboard/settings" element={<SettingsPage />} />
          {/* STEP 3. Reachable only by an explicit "Sign in" link — nothing
              redirects here, so the anonymous flow never encounters it. */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
      {/* STEP 4. Renders nothing unless a signed-in user has unclaimed guest rows,
          so it cannot interrupt an anonymous visit. */}
      <ClaimGuestDataPrompt />
      {loadState === "error" ? (
        <div role="alert" className="dashboard-global-error">
          Something went wrong loading your boards.
        </div>
      ) : null}
    </BrowserRouter>
  );
};
