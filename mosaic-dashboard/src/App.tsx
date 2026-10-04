import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { storage } from "@/lib/storage";
import { ActivityPage } from "@/pages/ActivityPage";
import { BoardPage } from "@/pages/BoardPage";
import { BoardsPage } from "@/pages/BoardsPage";
import { LoginPage } from "@/pages/LoginPage";
import { SettingsPage } from "@/pages/SettingsPage";
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
      <AppShell>
        <Routes>
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
          {/* Editor hand-off. The dashboard routes the user to the editor app
              with #board=<id>; this route renders the in-dashboard editor view
              used in dev and by the e2e test. */}
          <Route path="/board/:id" element={<BoardPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AppShell>
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
