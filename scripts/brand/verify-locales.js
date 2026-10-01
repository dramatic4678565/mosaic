import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const dir = join(process.cwd(), "packages", "excalidraw", "locales");
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

let bad = 0;
for (const f of files) {
  try {
    JSON.parse(readFileSync(join(dir, f), "utf8"));
  } catch (e) {
    console.log("INVALID", f, e.message);
    bad += 1;
  }
}
console.log(bad ? `${bad} invalid` : `all ${files.length} locale JSONs valid`);

const en = readFileSync(join(dir, "en.json"), "utf8");
const requiredKeys = [
  "madeWithExcalidraw",
  "mermaidToExcalidraw",
  "excalidrawLib",
  "excalidrawplus_description",
];
for (const k of requiredKeys) {
  console.log(`key "${k}" present: ${en.includes(`"${k}"`)}`);
}