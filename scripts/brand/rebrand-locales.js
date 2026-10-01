/**
 * Rebrand user-visible product-name strings inside locale JSON files.
 *
 * Rules:
 *  - Only JSON *values* are rewritten. Keys are the contract between code and
 *    the translation platform and must stay untouched.
 *  - "Excalidraw+" is a separate, live paid product (plus.excalidraw.com) that
 *    we do not own and have no equivalent of. It is preserved verbatim.
 *  - ".excalidraw" file extension and MIME types are preserved verbatim.
 *  - Transliterated product names (e.g. Bengali "এক্সক্যালিড্র") are rewritten
 *    too, otherwise the brand leaks in non-Latin locales.
 */
import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const LOCALES_DIR = join(process.cwd(), "packages", "excalidraw", "locales");

/**
 * Protected substrings that must survive untouched.
 *
 * Note: the MIME type `application/vnd.excalidraw+json` and the `.excalidraw`
 * extension are lowercase, so they are already covered by the literal
 * `Excalidraw` -> `Mosaic` replacement not touching them. A hyphenated
 * "Excalidraw-JSON-Daten" (German compound) *is* a product reference in prose
 * and must be rebranded, so it is deliberately not protected here.
 */
const PROTECTED = ["Excalidraw+"];

/** Transliterated / localized product names to normalise. */
const TRANSLITERATED = ["এক্সক্যালিড্র"];

/**
 * Returns the length of a protected token starting at `index`, or 0.
 * Extracted from the loop below to avoid a closure over the mutable index.
 */
const protectedLengthAt = (value, index) => {
  for (const token of PROTECTED) {
    if (value.startsWith(token, index)) {
      return token.length;
    }
  }
  return 0;
};

/**
 * Rewrites `Excalidraw` -> `Mosaic` outside of protected contexts.
 */
const rewriteValue = (value) => {
  for (const token of TRANSLITERATED) {
    value = value.split(token).join("Mosaic");
  }

  let result = "";
  let i = 0;
  while (i < value.length) {
    const protectedLength = protectedLengthAt(value, i);
    if (protectedLength) {
      result += value.slice(i, i + protectedLength);
      i += protectedLength;
      continue;
    }
    if (value.startsWith("Excalidraw", i)) {
      result += "Mosaic";
      i += "Excalidraw".length;
      continue;
    }
    result += value[i];
    i += 1;
  }
  return result;
};

/**
 * Walks the parsed JSON and rewrites string values in place, preserving key
 * order and formatting of the original file (2-space indent, trailing newline).
 */
const walk = (node) => {
  if (typeof node === "string") {
    return rewriteValue(node);
  }
  if (Array.isArray(node)) {
    return node.map(walk);
  }
  if (node && typeof node === "object") {
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = walk(value);
    }
    return out;
  }
  return node;
};

const processFile = (file) => {
  const path = join(LOCALES_DIR, file);
  const original = readFileSync(path, "utf8");
  const parsed = JSON.parse(original);
  const next = walk(parsed);
  const serialized = `${JSON.stringify(next, null, 2)}\n`;
  if (serialized !== original) {
    writeFileSync(path, serialized, "utf8");
    return true;
  }
  return false;
};

const files = readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".json"));

let changed = 0;
for (const file of files) {
  if (processFile(file)) {
    changed += 1;
    console.log(`  rebranded ${file}`);
  }
}
console.log(`\n${changed}/${files.length} locale files updated`);
