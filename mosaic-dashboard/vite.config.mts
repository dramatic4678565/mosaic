import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig, loadEnv } from "vite";

/**
 * Vite config for the Mosaic dashboard.
 *
 * Three things matter here beyond a stock React setup:
 *
 * 1. `@mosaic/brand` is a workspace TypeScript source package, not a published
 *    npm artifact. There is no build step for it, so it has to be aliased to its
 *    `src/` entry the same way `excalidraw-app/vite.config.mts` aliases the other
 *    `@excalidraw/*` workspace packages. Without this the import fails to resolve.
 *
 * 2. The public base path. Three deployments, one variable:
 *      - production (nginx in `Dockerfile`): `/` — the dashboard is the root
 *      - local dev (proxied through the editor on :3000): `/dashboard/`
 *      - e2e (served by `e2e/preview-server.mjs`): `/`
 *    `MOSAIC_DASHBOARD_BASE` selects between them. It is read through `loadEnv`
 *    rather than `process.env` so a plain `.env.<mode>` file can set it, which is
 *    what keeps the config cross-platform (inline `FOO=bar cmd` is POSIX-only).
 *
 * 3. The editor mount point, `VITE_EDITOR_BASE`. Default `/app/` to match nginx;
 *    dev and e2e point it at wherever their proxy mounts the editor.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const BASE_URL = env.MOSAIC_DASHBOARD_BASE || "/";
  // Exposed to the client explicitly: Vite only injects `VITE_`-prefixed
  // variables, and the router basename needs to be independent of `base`.
  const BASENAME = env.MOSAIC_DASHBOARD_BASENAME || "";

  return {
    base: BASE_URL,
    define: {
      "import.meta.env.MOSAIC_DASHBOARD_BASENAME": JSON.stringify(BASENAME),
    },
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
    // Own port in dev. The editor's dev server owns 3000 and proxies
    // `/dashboard` and `/board/*` here, so both apps are reachable through the
    // editor's origin and stay same-origin for IndexedDB.
    port: Number(env.VITE_APP_PORT || 3002),
    strictPort: true,
    /**
     * Same-origin proxy for the editor, and it is not optional sugar.
     *
     * The editor reads board scenes straight out of IndexedDB. IndexedDB is
     * partitioned per origin, so if the dev dashboard ran on :3002 and the dev
     * editor on :3000, the editor would look in a *different* database than the
     * one the dashboard writes and would always open an empty board.
     *
     * Proxying keeps the pair on one origin. This is what makes board mode work
     * at all outside of a production build, where nginx does the same job.
     *
     * Two details matter:
     *
     * - The proxy forwards the path *unchanged*. The editor's dev server is
     *   started with `EXCALIDRAW_BASE_PATH=/editor` (see
     *   excalidraw-app/vite.config.mts) so it emits `/editor/`-prefixed module
     *   URLs. Stripping the prefix here would make the editor emit
     *   root-relative URLs that the browser then requests from the dashboard
     *   origin, where they 404 - the editor's module graph does not exist there.
     * - The hash fragment never reaches the server, so `#board=<id>` is read
     *   client-side by the editor's board mode, untouched.
     */
    proxy: {
      "/editor": {
        target: env.VITE_EDITOR_ORIGIN || "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
    preview: {
      port: Number(env.VITE_APP_PORT || 3002),
    },
    build: {
      outDir: "dist",
      sourcemap: true,
    },
  };
});