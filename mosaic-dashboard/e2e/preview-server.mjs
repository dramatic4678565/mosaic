import { createServer } from "http";
import { readFile, stat } from "fs/promises";
import { extname, join } from "path";

/**
 * Static preview server for the e2e suite.
 *
 * Why not just run two Vite dev servers (which is what the suite used to do)?
 *
 * 1. It ran out of memory. The excalidraw dev server is large and its
 *    `vite-plugin-checker` runs TypeScript in-process; alongside the dashboard's
 *    dev server, a Chromium instance and the test runner it exhausted RAM on a
 *    16 GB machine and the dev server died mid-run. That surfaced as a wall of
 *    `ERR_CONNECTION_REFUSED`, which is a miserable thing to debug.
 * 2. It tested the wrong thing. Production serves two *built* bundles from one
 *    nginx, not two dev servers. Testing the built output means the e2e suite
 *    exercises the same asset graph, base paths and routing that ships — so a
 *    base-path mistake (exactly the kind of bug this suite exists to catch)
 *    cannot hide behind dev-server conveniences.
 *
 * The routing mirrors `docker/nginx.conf` deliberately:
 *
 *   /            -> mosaic-dashboard/dist   (SPA, history fallback)
 *   /editor/     -> excalidraw-app/build    (SPA, history fallback)
 *
 * `EDITOR_BASE` must match `VITE_EDITOR_BASE` used to build the dashboard, and
 * the playwright config passes the same value to both sides.
 */

const DASHBOARD_DIST = process.env.DASHBOARD_DIST ?? "";
const EDITOR_BUILD = process.env.EDITOR_BUILD ?? "";
const PORT = Number(process.env.PORT ?? 3101);
const EDITOR_BASE = process.env.EDITOR_BASE ?? "/editor";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Strips `..` segments from a URL path without touching its separators.
 *
 * Do NOT use `path.normalize` here. On Windows it rewrites forward slashes to
 * backslashes, so `normalize("/editor/")` returns `\editor\` and every
 * `pathname.startsWith("/editor/")` check silently fails — the editor branch is
 * then never taken and the dashboard's index.html gets served for `/editor/`.
 * That bug is invisible on Linux CI and reproduces only on Windows, so the
 * path handling here stays plain-string on purpose.
 */
const safeRelPath = (pathname) => {
  const segments = pathname.split("/").filter((s) => s && s !== "." && s !== "..");
  return segments.join("/");
};

const isDirectory = async (path) => {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
};

const serveFile = async (res, path) => {
  try {
    const body = await readFile(path);
    res.writeHead(200, {
      "content-type": TYPES[extname(path)] ?? "application/octet-stream",
      // Never cache during tests: a stale bundle would silently invalidate a
      // result, which is the worst possible failure mode for an e2e suite.
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
};

/**
 * Serves one SPA root.
 *
 * `rel` is the path *after* stripping the mount prefix, still slash-separated
 * and already traversal-safe. An extension-less path falls back to the shell
 * (history routing); anything with an extension is treated as a real asset, so a
 * genuinely missing .js reports 404 instead of silently returning HTML.
 */
const serveSpa = async (res, root, rel) => {
  const clean = safeRelPath(rel);
  if (clean === "") {
    await serveFile(res, join(root, "index.html"));
    return;
  }
  const target = join(root, clean);
  if (!extname(clean) && !(await isDirectory(target))) {
    await serveFile(res, join(root, "index.html"));
    return;
  }
  await serveFile(res, target);
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  // Raw pathname: see the note on safeRelPath about path.normalize on Windows.
  const pathname = decodeURIComponent(url.pathname);

  // The editor's built HTML links a sitemap at the site root, but the editor
  // build does not emit one. Serve an empty valid sitemap so the request is not
  // a 404 in the console during tests. Harmless and matches production, where
  // nginx serves a hand-written sitemap for the dashboard.
  if (pathname === "/sitemap.xml") {
    res.writeHead(200, { "content-type": "application/xml; charset=utf-8" });
    res.end(
      '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>',
    );
    return;
  }

  if (pathname === EDITOR_BASE || pathname.startsWith(`${EDITOR_BASE}/`)) {
    await serveSpa(res, EDITOR_BUILD, pathname.slice(EDITOR_BASE.length));
    return;
  }

  await serveSpa(res, DASHBOARD_DIST, pathname);
}).listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[preview] dashboard ${DASHBOARD_DIST} at /  |  editor ${EDITOR_BUILD} at ${EDITOR_BASE}/  |  http://localhost:${PORT}`,
  );
});