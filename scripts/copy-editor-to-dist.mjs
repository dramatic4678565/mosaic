import { cp, mkdir, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copies the built editor into the dashboard's dist so Vercel can serve both
 * from one static output.
 *
 * Vercel's `outputDirectory` is a single directory, but Mosaic has two Vite apps.
 * Rather than fighting Vercel with a monorepo-aware build, the dashboard build
 * becomes the output root and the editor is nested inside it at `/editor`, which
 * is exactly the mount point `vercel.json` rewrites `/app/*` to.
 *
 * Uses fs.promises.cp so the copy is recursive and platform-consistent without
 * pulling in a dependency.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(repoRoot, "excalidraw-app", "build");
const DEST = join(repoRoot, "mosaic-dashboard", "dist", "editor");

const fail = (message) => {
  console.error(`[copy-editor] ${message}`);
  process.exit(1);
};

if (!existsSync(SOURCE)) {
  fail(
    `editor build not found at ${SOURCE}\n` +
      `           run "yarn build:editor" first (or use "yarn build:all").`,
  );
}

await mkdir(DEST, { recursive: true });

const entries = await readdir(SOURCE);
for (const entry of entries) {
  const from = join(SOURCE, entry);
  const to = join(DEST, entry);

  const isDir = (await stat(from)).isDirectory();
  await cp(from, to, { recursive: true });
  console.log(
    `[copy-editor] ${isDir ? "dir " : "file"}  editor/${entry}`,
  );
}

console.log(
  `[copy-editor] done — ${entries.length} top-level entr${
    entries.length === 1 ? "y" : "ies"
  } copied into mosaic-dashboard/dist/editor/`,
);