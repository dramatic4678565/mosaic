import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

/**
 * Builds both apps with the base paths the e2e suite serves them at.
 *
 * Why a script instead of inline env vars in an npm script: `FOO=bar yarn build`
 * is POSIX-only and silently does the wrong thing in cmd.exe, and this repo has
 * no `cross-env` dependency (Part 3 explicitly requires Windows PowerShell to
 * work). A tiny Node wrapper is the cross-platform answer with zero new deps.
 *
 * The pairing that matters:
 *
 *   editor   EXCALIDRAW_BASE_PATH=/editor
 *     └─ makes the editor's index.html and every hashed asset URL
 *        /editor/relative instead of /relative
 *   dashboard VITE_EDITOR_BASE=/editor
 *     └─ makes the dashboard point its iframe at /editor/
 *     (read from mosaic-dashboard/.env.e2e by `vite build --mode e2e`)
 *   server   EDITOR_BASE=/editor   (mosaic-dashboard/e2e/preview-server.mjs)
 *
 * Get any one of these out of step and the editor silently fails to load with a
 * 404 for a hashed chunk and a blank canvas — no exception, no useful log. That
 * is why all three live in one place.
 *
 * Production builds are unaffected: the Dockerfile uses the defaults
 * (`/` for the dashboard, `/app/` for the editor).
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const run = (command, args, env) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
      shell: true,
      env: { ...process.env, ...env },
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
      }
    });
    child.on("error", reject);
  });

const steps = [
  {
    label: "editor (base=/editor/)",
    command: "yarn",
    args: ["build"],
    env: { EXCALIDRAW_BASE_PATH: "/editor" },
  },
  {
    label: "dashboard (mode=e2e)",
    command: "yarn",
    args: ["--cwd", "mosaic-dashboard", "build:e2e"],
    env: {},
  },
];

for (const step of steps) {
  console.log(`\n[build-e2e] ${step.label}`);
  await run(step.command, step.args, step.env);
}

console.log("\n[build-e2e] both apps built for e2e");