import { spawn } from "child_process";
import { setTimeout as sleep } from "timers/promises";

/**
 * Captures README screenshots from the built output.
 *
 * Serves both apps the same way `docker/nginx.conf` does, drives headless
 * Chrome, and writes PNGs into `docs/`. Run with: node scripts/screenshots.js
 *
 * Kept as a script rather than committed binaries so the images can always be
 * regenerated after a UI change instead of drifting out of date.
 */
const PORT = 3199;
const ROOT = process.cwd();
const CHROME =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = `${ROOT}\\.screenshot-profile`;

const server = spawn(
  process.execPath,
  ["mosaic-dashboard/e2e/preview-server.mjs"],
  {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      EDITOR_BASE: "/editor",
      DASHBOARD_DIST: "./mosaic-dashboard/dist",
      EDITOR_BUILD: "./excalidraw-app/build",
    },
    stdio: "inherit",
  },
);

const shot = (url, out, width = 1440, height = 900) =>
  new Promise((resolve) => {
    const proc = spawn(
      CHROME,
      [
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
        `--user-data-dir=${PROFILE}`,
        "--virtual-time-budget=15000",
        `--window-size=${width},${height}`,
        `--screenshot=${out}`,
        url,
      ],
      { stdio: "inherit" },
    );
    proc.on("exit", resolve);
  });

try {
  await sleep(2500);
  await shot(
    `http://localhost:${PORT}/dashboard`,
    `${ROOT}/docs/dashboard.png`,
  );
  console.log("captured docs/dashboard.png");
  await shot(
    `http://localhost:${PORT}/editor/`,
    `${ROOT}/docs/editor.png`,
    1440,
    900,
  );
  console.log("captured docs/editor.png");
} finally {
  server.kill();
  server.on("exit", () => process.exit(0));
}
