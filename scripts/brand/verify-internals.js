/**
 * Verifies that the rebrand did not touch any internal identifier.
 *
 * Compares the working tree against `upstream/master` for every protected
 * category and fails loudly if anything drifted.
 */
import { execFileSync } from "child_process";

const run = (args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/**
 * The baseline is the **merge base** with upstream, not `upstream/master`'s tip.
 *
 * That distinction matters and cost a CI cycle to learn. Comparing raw
 * occurrence counts against upstream's tip produces a false "occurrences were
 * REMOVED" whenever upstream has *added* code we have not merged yet: those
 * occurrences are new upstream code, not renames on our side. Counting them as
 * "present upstream, absent here" blames us for code we have simply never
 * taken.
 *
 * The merge base is the upstream commit we actually forked from (or last
 * synced). "Did a rebrand remove something that was ours?" is exactly the
 * question this guard should answer.
 *
 * Falls back to `upstream/master` when there is no merge base — e.g. a
 * repository created from a shallow copy with no shared history.
 */
const resolveBaseline = () => {
  try {
    const base = run([
      "merge-base",
      "HEAD",
      "upstream/master",
    ]).trim();
    if (base) {
      return base;
    }
  } catch {
    // No shared history; fall through.
  }
  return "upstream/master";
};

const BASE = resolveBaseline();

/**
 * Fail fast, and legibly, when the baseline ref is missing.
 *
 * `git grep <unknown-rev>` exits 128 with "unable to resolve revision". Without
 * this check that surfaces as an opaque child-process error and looks like a
 * rebrand failure. A shallow CI checkout with only `origin` configured is the
 * usual cause.
 */
try {
  run(["rev-parse", "--verify", BASE]);
} catch {
  console.error(
    `\nBaseline ref "${BASE}" is not available in this checkout.\n` +
      "This guard compares the working tree against the upstream commit we\n" +
      "forked from, so it needs upstream available:\n\n" +
      "  git remote add upstream https://github.com/excalidraw/excalidraw.git\n" +
      "  git fetch upstream master\n",
  );
  process.exit(1);
}

/**
 * Counts matching lines, ignoring comment-only and block-comment content.
 *
 * The rebrand documentation legitimately *mentions* protected tokens —
 * explaining why `@excalidraw/*` must not be renamed, listing `.excalidraw`,
 * naming `EXCALIDRAW_ASSET_PATH`. Counting that prose as drift makes the guard
 * worthless: it would fire on correct documentation, so it would get switched
 * off, which is a worse outcome than no guard.
 *
 * Only real code lines are counted, which is the thing that actually matters:
 * did any live identifier change?
 */
const countAt = (rev, pattern, extra = []) => {
  let out;
  try {
    out = run([
      "grep",
      "-I",
      "-n",
      "-e",
      pattern,
      ...(rev ? [rev] : []),
      "--",
      ...extra,
    ]);
  } catch (e) {
    // git grep exits 1 when there are no matches
    if (e.status === 1) {
      return 0;
    }
    throw e;
  }

  let count = 0;
  for (const line of out.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    // "<rev>:<path>:<lineno>:<text>" — keep only the source text.
    const text = line.replace(/^[^:]*:[^:]*:\d+:/, "");
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/, "");

    // `git grep -n` prints only the matching line, so a JSDoc block is matched
    // on its `* ...` continuation lines rather than its `/**` opener. Those
    // lines are comments too and must not count. The same goes for JSX comment
    // markers.
    const trimmed = code.trim();
    if (
      trimmed.startsWith("*") ||
      trimmed.startsWith("//") ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith("{/*") ||
      trimmed === "" ||
      trimmed.startsWith("*/")
    ) {
      continue;
    }

    if (code.includes(pattern)) {
      count += 1;
    }
  }
  return count;
};

/**
 * Verifies a protected identifier was not *renamed away*.
 *
 * The rule is `after >= before`, not `after === before`, and the difference
 * matters:
 *
 * - A rename removes every upstream occurrence. That is the failure this guard
 *   exists to catch, and `after < before` catches it exactly.
 * - Legitimate work *adds* mentions. Part 2's board mode has to name
 *   `excalidraw-library`, `EXCALIDRAW_ASSET_PATH` and `ExcalidrawElement` in
 *   order to talk to the editor, and Part 3's build config adds
 *   `EXCALIDRAW_BASE_PATH`. Those are new lines referencing existing
 *   identifiers, not renames.
 *
 * An earlier version compared exact counts and therefore reported drift on
 * correct changes — which is worse than having no guard, because the response
 * to a false alarm is to switch the guard off.
 *
 * Comment and doc-comment lines are stripped by `countAt` for the same reason:
 * the rebrand documentation has to *name* the tokens it forbids renaming.
 */
const check = (label, pattern, paths) => {
  const before = countAt(BASE, pattern, paths);
  const after = countAt(null, pattern, paths);
  const ok = after >= before;
  console.log(
    `${ok ? "OK  " : "FAIL"}  ${label.padEnd(46)} upstream=${String(
      before,
    ).padStart(5)}  now=${String(after).padStart(5)}${
      ok ? "" : "   <-- occurrences were REMOVED (renamed?)"
    }`,
  );
  return ok;
};

let allOk = true;

/**
 * Paths that Mosaic itself added and that have no upstream counterpart.
 *
 * The question this guard answers is "did any *upstream* identifier change?".
 * Mosaic's own new files (`boardMode.ts` is a deliberate, documented bridge that
 * has to name `excalidraw-library`, `EXCALIDRAW_ASSET_PATH` and friends) are
 * new code, not a rename, so counting them would report drift on every correct
 * change.
 */
const MOSAIC_OWNED_EXCLUDES = [
  ":(exclude)excalidraw-app/boardMode.ts",
  ":(exclude)scripts",
  ":(exclude)mosaic-dashboard",
];

const UPSTREAM_PATHS = ["packages", "excalidraw-app"];

console.log(`=== INTERNAL identifiers (baseline: ${BASE.slice(0, 12)}) ===\n`);
allOk =
  check(
    "@excalidraw/* imports (code, comments ignored)",
    'from "@excalidraw/',
    [...UPSTREAM_PATHS, ...MOSAIC_OWNED_EXCLUDES],
  ) && allOk;
allOk =
  check("localStorage keys", "excalidraw-state", [
    ...UPSTREAM_PATHS,
    ...MOSAIC_OWNED_EXCLUDES,
  ]) && allOk;
allOk =
  check("localStorage elements key", '"excalidraw"', [
    "excalidraw-app/app_constants.ts",
  ]) && allOk;
allOk =
  check("IndexedDB stores", "IDB_LIBRARY", [
    "excalidraw-app/app_constants.ts",
  ]) && allOk;
allOk =
  check("MIME type", "vnd.excalidraw", [
    ...UPSTREAM_PATHS,
    ...MOSAIC_OWNED_EXCLUDES,
  ]) && allOk;
allOk =
  // Plain substring, not a regex: `git grep -e` treats the pattern literally,
  // so passing "\.excalidraw" would search for a literal backslash and silently
  // match nothing.
  check(".excalidraw extension", ".excalidraw", [
    ...UPSTREAM_PATHS,
    ...MOSAIC_OWNED_EXCLUDES,
  ]) && allOk;
allOk =
  check("Sentry / build globals", "EXCALIDRAW_ASSET_PATH", [
    ...UPSTREAM_PATHS,
    ...MOSAIC_OWNED_EXCLUDES,
  ]) && allOk;
allOk =
  check("window.name tab key", '"_excalidraw"', ["excalidraw-app"]) && allOk;
allOk =
  check("ExcalidrawError class", "ExcalidrawError", [
    ...UPSTREAM_PATHS,
    ...MOSAIC_OWNED_EXCLUDES,
  ]) && allOk;
allOk =
  check("ExcalidrawElement type", "ExcalidrawElement", [
    ...UPSTREAM_PATHS,
    ...MOSAIC_OWNED_EXCLUDES,
  ]) && allOk;
allOk =
  check("CSS class names", "excalidraw-ui-", [
    ...UPSTREAM_PATHS,
    ...MOSAIC_OWNED_EXCLUDES,
  ]) && allOk;
allOk =
  check("workspace package names", '"@excalidraw/', [
    ...UPSTREAM_PATHS,
    ...MOSAIC_OWNED_EXCLUDES,
  ]) && allOk;

console.log("\n=== LEGAL / attribution (must be untouched) ===\n");
for (const file of [
  "LICENSE",
  "packages/laser-pointer/LICENSE",
  "packages/common/LICENSE",
  "packages/element/LICENSE",
]) {
  let ok = false;
  try {
    const diff = run(["diff", "--stat", BASE, "--", file]).trim();
    ok = diff === "";
    console.log(
      `${ok ? "OK  " : "FAIL"}  ${file.padEnd(46)} ${
        diff || "(identical to upstream)"
      }`,
    );
  } catch {
    console.log(`SKIP  ${file.padEnd(46)} (not present)`);
  }
  if (!ok) {
    allOk = false;
  }
}

console.log(
  `\n${
    allOk
      ? "PASS - no internal identifier was renamed."
      : "FAIL - drift detected."
  }`,
);
process.exit(allOk ? 0 : 1);
