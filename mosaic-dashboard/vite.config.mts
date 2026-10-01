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
 *    matching basename. Both are read from BASE_URL so dev (served at `/`) and
 *    prod (served at `/dashboard/`) work from the same code.
 */
const BASE_URL = process.env.MOSAIC_DASHBOARD_BASE ?? "/dashboard/";

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
  },
  preview: {
    port: Number(process.env.VITE_APP_PORT || 3001),
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});