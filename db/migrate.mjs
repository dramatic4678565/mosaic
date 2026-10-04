import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { neon } from "@neondatabase/serverless";

/**
 * Applies the SQL files in `db/migrations/` to Neon, in filename order, once each.
 *
 * Design notes
 * ------------
 *
 * - **A ledger, not a schema introspection.** `_migrations` records the exact
 *   filenames already applied. Comparing filenames is what makes re-running
 *   safe: `CREATE TABLE IF NOT EXISTS` happens to be idempotent, but a later
 *   migration containing `ALTER` or an `INSERT` is not, and a ledger is the only
 *   way to guarantee each file runs exactly once.
 *
 * - **One transaction per file, via an array of statements.** The Neon HTTP
 *   driver refuses to send multiple commands in a single prepared statement
 *   ("cannot insert multiple commands into a prepared statement"), and
 *   `sql.transaction()` accepts an array of `Query` objects (or a function
 *   returning one), not SQL strings. So each file is split into statements and
 *   handed over as separate queries inside one BEGIN/COMMIT, with the ledger row
 *   last — a file is therefore either fully applied and recorded, or neither.
 *
 * - **The splitter is quote- and comment-aware** because the schema contains
 *   literals like `DEFAULT 'Untitled'` and `DEFAULT 'blue'`. A naive split on
 *   `;` would corrupt those.
 *
 * - **Sorted by filename.** The `001_`, `002_` prefix is the ordering contract.
 *
 * - **The connection string is never logged.** Only whether it looks pooled.
 *
 * Usage:
 *   yarn db:migrate
 *   dotenv -e .env.local -- yarn db:migrate   (POSIX)
 *   $env:DATABASE_URL="..."; yarn db:migrate (PowerShell)
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = join(repoRoot, "db", "migrations");

const fail = (message, code = 1) => {
  console.error(`[db:migrate] ${message}`);
  process.exit(code);
};

const url = process.env.DATABASE_URL;
if (!url) {
  fail(
    "DATABASE_URL is not set.\n" +
      "           Put it in .env.local (git-ignored) and export it before running,\n" +
      "           e.g.  dotenv -e .env.local -- yarn db:migrate",
  );
}

// The Neon skill's guidance: pooled (-pooler) is for app traffic, direct is for
// migrations. Report which is in use without revealing the URL.
console.log(
  `[db:migrate] connection: ${
    url.includes("-pooler.")
      ? "pooled (-pooler)"
      : "direct — correct for migrations; app traffic wants -pooler"
  }`,
);

const sql = neon(url);

/**
 * Splits a SQL file into individual statements.
 *
 * Handles the three things that would otherwise break a naive `split(";")`:
 * single-quoted literals, `--` line comments, and block comments.
 */
const splitStatements = (text) => {
  const statements = [];
  let current = "";
  let inSingle = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        current += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inSingle) {
      current += ch;
      if (ch === "'") {
        // '' inside a literal is an escaped quote, not a terminator.
        if (next === "'") {
          current += next;
          i++;
        } else {
          inSingle = false;
        }
      }
      continue;
    }

    if (ch === "-" && next === "-") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      current += ch;
      continue;
    }
    if (ch === ";") {
      const trimmed = current.trim();
      if (trimmed) {
        statements.push(trimmed);
      }
      current = "";
      continue;
    }
    current += ch;
  }

  const tail = current.trim();
  if (tail) {
    statements.push(tail);
  }
  return statements;
};

let files;
try {
  files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();
} catch (error) {
  fail(
    `could not read ${MIGRATIONS_DIR}: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

if (files.length === 0) {
  console.log("[db:migrate] no .sql files found — nothing to do");
  process.exit(0);
}

// The ledger must exist before we can ask what has already run.
await sql`
  CREATE TABLE IF NOT EXISTS _migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

const appliedRows = await sql`SELECT filename FROM _migrations`;
const applied = new Set(
  appliedRows.map((r) => (Array.isArray(r) ? r[0] : r.filename)),
);

console.log(
  `[db:migrate] ${files.length} migration file(s), ${applied.size} already applied`,
);

let ran = 0;
for (const file of files) {
  if (applied.has(file)) {
    console.log(`[db:migrate] skip    ${file} (already applied)`);
    continue;
  }

  const contents = await readFile(join(MIGRATIONS_DIR, file), "utf8");
  const statements = splitStatements(contents);

  try {
    await sql.transaction([
      ...statements.map((statement) => sql.query(statement)),
      // Ledger row last, inside the same transaction.
      sql.query("INSERT INTO _migrations (filename) VALUES ($1)", [file]),
    ]);
    ran += 1;
    console.log(
      `[db:migrate] applied ${file} (${statements.length} statements)`,
    );
  } catch (error) {
    // The failing filename is in the message on purpose: it is the one piece of
    // context anyone debugging this needs, and it is not a secret.
    fail(
      `migration failed: ${file}\n           ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

console.log(
  `[db:migrate] done — ${ran} applied, ${files.length - ran} skipped`,
);
