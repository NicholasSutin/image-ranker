// Scans public/images/<set>/ and writes src/manifest.json: { "<set>": ["/images/<set>/<file>", ...] }.
// Images dropped directly in public/images/ go into a set called "default".
// Also writes resized WebP copies to public/sized/<width>/<same path>.webp; the pages only ever load
// those (the originals are huge and aren't deployed, see public/.assetsignore).
import { readdirSync, writeFileSync, statSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import sharp from "sharp";

const ROOT = "public/images";
const SIZED = "public/sized";
// Keep in sync with sized() in public/*.js: thumbnails, results-page tiles, and on-screen display.
const WIDTHS = [160, 800, 1600];
const IMAGE = /\.(jpe?g|png|webp|gif|avif|svg)$/i;
const url = (...parts) => "/" + ["images", ...parts].map(encodeURIComponent).join("/");

const manifest = {};
const sources = []; // paths relative to ROOT
for (const entry of readdirSync(ROOT).sort()) {
  if (entry.startsWith(".")) continue;
  const path = join(ROOT, entry);
  if (statSync(path).isDirectory()) {
    const files = readdirSync(path).filter((f) => !f.startsWith(".") && IMAGE.test(f)).sort();
    if (files.length >= 2) {
      manifest[entry] = files.map((f) => url(entry, f));
      sources.push(...files.map((f) => join(entry, f)));
    }
  } else if (IMAGE.test(entry)) {
    (manifest.default ??= []).push(url(entry));
    sources.push(entry);
  }
}

writeFileSync("src/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
const summary = Object.entries(manifest).map(([s, f]) => `${s} (${f.length})`).join(", ");
console.log(`manifest: ${summary || "no sets with 2+ images found"}`);

// ---------- resized copies ----------

const webpPath = (rel) => rel.replace(/\.[^./]+$/, ".webp");
const expected = new Set();
let made = 0;
for (const rel of sources) {
  const out = webpPath(rel);
  if (expected.has(join("160", out))) throw new Error(`Two images would both resize to ${out}; rename one.`);
  const src = join(ROOT, rel);
  const srcTime = statSync(src).mtimeMs;
  for (const width of WIDTHS) {
    const dest = join(SIZED, String(width), out);
    expected.add(relative(SIZED, dest));
    if (existsSync(dest) && statSync(dest).mtimeMs >= srcTime) continue;
    mkdirSync(dirname(dest), { recursive: true });
    // rotate() applies the EXIF orientation; output is converted to sRGB by default.
    await sharp(src).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 82 }).toFile(dest);
    made++;
  }
}

// Drop copies of images that were removed or renamed.
let removed = 0;
for (const rel of existsSync(SIZED) ? readdirSync(SIZED, { recursive: true }) : []) {
  const path = join(SIZED, rel);
  if (statSync(path).isFile() && !expected.has(rel)) {
    rmSync(path);
    removed++;
  }
}
console.log(`sized: ${made} written, ${removed} removed, ${expected.size - made} up to date`);
