// Scans public/images/<set>/ and writes src/manifest.json: { "<set>": ["/images/<set>/<file>", ...] }.
// Images dropped directly in public/images/ go into a set called "default".
import { readdirSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "public/images";
const IMAGE = /\.(jpe?g|png|webp|gif|avif|svg)$/i;
const url = (...parts) => "/" + ["images", ...parts].map(encodeURIComponent).join("/");

const manifest = {};
for (const entry of readdirSync(ROOT).sort()) {
  if (entry.startsWith(".")) continue;
  const path = join(ROOT, entry);
  if (statSync(path).isDirectory()) {
    const files = readdirSync(path).filter((f) => !f.startsWith(".") && IMAGE.test(f)).sort();
    if (files.length >= 2) manifest[entry] = files.map((f) => url(entry, f));
  } else if (IMAGE.test(entry)) {
    (manifest.default ??= []).push(url(entry));
  }
}

writeFileSync("src/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
const summary = Object.entries(manifest).map(([s, f]) => `${s} (${f.length})`).join(", ");
console.log(`manifest: ${summary || "no sets with 2+ images found"}`);
