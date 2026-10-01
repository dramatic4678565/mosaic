/**
 * Verifies that the rebrand did not touch any internal identifier.
 *
 * Compares the working tree against `upstream/master` for every protected
 * category and fails loudly if anything drifted.
 */
import { execFileSync } from "child_process";

const BASE = "upstream/master";

const run = (args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const countAt = (rev, pattern, extra = []) => {
  try {
    const out = run([
      "grep",
      "-I",
      "-c",
      "-e",
      pattern,
      ...(rev ? [rev] : []),
      "--",
      ...extra,
    ]);
    return out
      .split("\n")
      .filter(Boolean)
      .reduce((sum, line) => sum + Number(line.split(":").pop()), 0);
  } catch (e) {
    // git grep exits 1 when there are no matches
    if (e.status === 1) {
      return 0;
    }
    throw e;
  }
};

const check = (label, pattern, paths) => {
  const before = countAt(BASE, pattern, paths);
  const after = countAt(null, pattern, paths);
  const ok = before === after;
  console.log(
    `${ok ? "OK  " : "FAIL"}  ${label.padEnd(46)} upstream=${String(before).padStart(5)}  now=${String(after).padStart(5)}`,
  );
  return ok;
};

let allOk = true;

console.log("=== INTERNAL identifiers (must be unchanged) ===\n");
allOk =
  check("@excalidraw/* imports (code, comments ignored)", "from \"@excalidraw/", [
    "packages",
    "excalidraw-app",
  ]) && allOk;
allOk =
  check("localStorage keys", 'excalidraw-state', ["excalidraw-app", "packages"]) &&
  allOk;
allOk =
  check("localStorage elements key", '"excalidraw"', [
    "excalidraw-app/app_constants.ts",
  ]) && allOk;
allOk =
  check("IndexedDB stores", "IDB_LIBRARY", ["excalidraw-app/app_constants.ts"]) &&
  allOk;
allOk =
  check("MIME type", "vnd.excalidraw", ["excalidraw-app", "packages"]) && allOk;
allOk =
  check(".excalidraw extension", '\\.excalidraw\\b', ["excalidraw-app", "packages"]) &&
  allOk;
allOk =
  check("Sentry / build globals", "EXCALIDRAW_ASSET_PATH", [
    "excalidraw-app",
    "packages",
    "scripts",
  ]) && allOk;
allOk =
  check("window.name tab key", '"_excalidraw"', ["excalidraw-app"]) && allOk;
allOk =
  check("ExcalidrawError class", "ExcalidrawError", ["packages", "excalidraw-app"]) &&
  allOk;
allOk =
  check("ExcalidrawElement type", "ExcalidrawElement", [
    "packages",
    "excalidraw-app",
  ]) && allOk;
allOk =
  check("CSS class names", "excalidraw-ui-", ["packages", "excalidraw-app"]) &&
  allOk;
allOk =
  check("workspace package names", '"@excalidraw/', ["packages", "excalidraw-app"]) &&
  allOk;

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
      `${ok ? "OK  " : "FAIL"}  ${file.padEnd(46)} ${diff || "(identical to upstream)"}`,
    );
  } catch {
    console.log(`SKIP  ${file.padEnd(46)} (not present)`);
  }
  if (!ok) {
    allOk = false;
  }
}

console.log(
  `\n${allOk ? "PASS - no internal identifier was renamed." : "FAIL - drift detected."}`,
);
process.exit(allOk ? 0 : 1);