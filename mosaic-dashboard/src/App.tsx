import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { purgeExpiredTrash } from "@/db/operations";
import { ActivityPage } from "@/pages/ActivityPage";
import { BoardPage } from "@/pages/BoardPage";
import { BoardsPage } from "@/pages/BoardsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { useDashboardStore } from "@/state/useDashboardStore";
import { AppShell } from "@/components/shell/AppShell";

/**
 * Base path the dashboard is mounted at.
 *
 * In production the dashboard is served from `/dashboard/` by the same nginx that
 * serves the editor, so React Router needs a basename. In dev Vite serves it from
 * `/`, hence the env-driven default. Keeping this in one place avoids the
 * classic bug where links work in dev and 404 in prod.
 */
const BASENAME = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

export const App = () => {
  const loadState = useDashboardStore((s) => s.loadState);
  const reload = useDashboardStore((s) => s.reload);

  /**
   * Boot sequence:
   * 1. purge expired trash (STEP 7) before the first read, so the grid never
   *    renders a board that is about to disappear
   * 2. load boards / folders / activity
   *
   * Both are idempotent, so a React 18 StrictMode double-invoke in dev is safe.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await purgeExpiredTrash();
      } catch (error) {
        // A purge failure must not block the dashboard: worst case a stale board
        // lingers in trash until the next boot.
        console.warn("Trash purge failed", error);
      }
      if (!cancelled) {
        await reload();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

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
          {/* Editor hand-off. The dashboard routes the user to the editor app
              with #board=<id>; this route renders the in-dashboard editor view
              used in dev and by the e2e test. */}
          <Route path="/board/:id" element={<BoardPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AppShell>
      {loadState === "error" ? (
        <div role="alert" className="dashboard-global-error">
          Something went wrong loading your boards.
        </div>
      ) : null}
    </BrowserRouter>
  );
};
