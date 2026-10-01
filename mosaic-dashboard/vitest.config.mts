import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * Unit tests for the dashboard run in jsdom with a fake IndexedDB.
 *
 * `fake-indexeddb/auto` must be imported *before* anything touches Dexie, because
 * Dexie captures the global `indexedDB` at module-evaluation time. We do the
 * import here in `setupFiles` so every test file gets it first.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^@mosaic\/brand$/,
        replacement: path.resolve(__dirname, "../packages/mosaic-brand/src/index.ts"),
      },
      {
        find: /^@\/(.*?)/,
        replacement: path.resolve(__dirname, "./src/$1"),
      },
    ],
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});