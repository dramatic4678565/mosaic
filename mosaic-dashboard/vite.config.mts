import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

/**
 * Vite config for the Mosaic dashboard.
 *
 * Two things matter here beyond a stock React setup:
 *
 * 1. `@mosaic/brand` is a workspace TypeScript source package, not a published
 *    npm artifact. There is no build step for it, so it has to be aliased to its
 *    `src/` entry the same way `excalidraw-app/vite.config.mts` aliases the other
 *    `@excalidraw/*` workspace packages. Without this the import fails to resolve.
 *
 * 2. The dashboard is served from `/dashboard/` in production (same nginx as the
 *    editor), so `base` must match that sub-path and the router must use a
 *    matching basename. Both are driven by BASE_URL, overridable with
 *    MOSAIC_DASHBOARD_BASE: production sets `/dashboard/`, dev and the e2e run
 *    set `/`. One code path, two deployments.
 */
const BASE_URL = process.env.MOSAIC_DASHBOARD_BASE ?? "/";

export default defineConfig({
  base: BASE_URL,
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^@mosaic\/brand$/,
        replacement: path.resolve(__dirname, "../packages/mosaic-brand/src/index.ts"),
      },
      {
        find: /^@mosaic\/brand\/(.*?)/,
        replacement: path.resolve(__dirname, "../packages/mosaic-brand/src/$1"),
      },
      {
        find: /^@\/(.*?)/,
        replacement: path.resolve(__dirname, "./src/$1"),
      },
    ],
  },
  server: {
    port: Number(process.env.VITE_APP_PORT || 3001),
    strictPort: false,
    /**
     * Same-origin proxy for the editor, and it is not optional sugar.
     *
     * The editor reads board scenes straight out of IndexedDB. IndexedDB is
     * partitioned per origin, so if the dev dashboard ran on :3101 and the dev
     * editor on :3000, the editor would look in a *different* database than the
     * one the dashboard writes and would always open an empty board.
     *
     * Proxying `/editor` -> the editor dev server keeps both under one origin in
     * dev, exactly mirroring production where one nginx serves both. This is
     * what makes board mode work at all outside of a production build.
     *
     * Two details matter:
     *
     * Two details make it work:
     *
     * - The proxy forwards the path *unchanged*. The editor's dev server is
     *   started with `EXCALIDRAW_BASE_PATH=/editor` (see excalidraw-app/vite.config.mts)
     *   so it emits `/editor/`-prefixed module URLs. Stripping the prefix here
     *   would make the editor emit root-relative URLs that the browser then
     *   requests from the dashboard origin, where they 404 — the editor's
     *   module graph does not exist there.
     * - The hash fragment never reaches the server, so `#board=<id>` is read
     *   client-side by the editor's board mode, untouched.
     */
    proxy: {
      "/editor": {
        target: process.env.VITE_EDITOR_ORIGIN || "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: Number(process.env.VITE_APP_PORT || 3001),
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});