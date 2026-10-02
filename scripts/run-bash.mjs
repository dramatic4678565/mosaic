import { spawn } from "child_process";
import { existsSync } from "fs";

/**
 * Runs a shell script with whatever bash is actually available on this machine.
 *
 * Why this exists: on Windows, `bash` on PATH is very often the WSL stub, which
 * prints "Windows Subsystem for Linux has no installed distributions" and exits
 * non-zero — even though Git for Windows ships a perfectly good bash at a known
 * path. Every shell script in this repo therefore failed locally with a message
 * that says nothing about the real cause.
 *
 * Resolution order:
 *   1. POSIX bash (Linux/macOS, and Git Bash if it is first on PATH)
 *   2. Git Bash at its standard install locations
 *   3. a clear error, rather than a confusing WSL message
 *
 * Usage: node scripts/run-bash.mjs scripts/sync-upstream.sh [args...]
 */
const script = process.argv[2];
const args = process.argv.slice(3);

if (!script) {
  console.error("usage: node scripts/run-bash.mjs <script.sh> [args...]");
  process.exit(2);
}

const GIT_BASH_CANDIDATES = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  `${process.env.LOCALAPPDATA}\\Programs\\Git\\bin\\bash.exe`,
];

const isWindows = process.platform === "win32";

/** On Windows, prefer an explicit Git Bash over whatever `bash` resolves to. */
const resolveBash = () => {
  if (!isWindows) {
    return { command: "bash", args: [] };
  }
  for (const candidate of GIT_BASH_CANDIDATES) {
    if (existsSync(candidate)) {
      return { command: candidate, args: [] };
    }
  }
  return { command: "bash", args: [] };
};

const { command, args: prefix } = resolveBash();

const child = spawn(command, [...prefix, script, ...args], {
  stdio: "inherit",
  shell: false,
});

child.on("error", (error) => {
  console.error(`Could not run ${command}: ${error.message}`);
  if (isWindows) {
    console.error(
      "On Windows, install Git for Windows (it ships bash) or run this\n" +
        "script from WSL. See memory/MEMORY.md.",
    );
  }
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`script terminated by signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});
