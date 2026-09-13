#!/usr/bin/env node
/**
 * Turn a folder of dish photos into the shipped set, and print the mapping.
 *
 *   node scripts/dish-photos.mjs --list          what is needed, and how to name it
 *   node scripts/dish-photos.mjs                 convert ~/Desktop/flourish-photos
 *   node scripts/dish-photos.mjs --map           print the ITEM_PHOTOS block to paste
 *
 * Why a script rather than doing it by hand: 35 photos is enough that one of
 * them will be 4MB, or a JPEG named IMG_4471, or 900x600 and crop badly — and
 * the failure is silent, because a heavy image only shows up as a slow menu on
 * a phone on cellular. The spec is in docs/DISH-PHOTOS.md; this enforces it.
 *
 * MATCHING IS BY DISH NAME, not by Clover id, because nobody downloading from a
 * merchant portal is going to name a file "60KCQ1V22Q98M.jpg". Names are
 * normalised hard — lowercased, everything but letters and digits removed — so
 * "Oxtail.jpg", "oxtail-plate.JPEG" and "Ox Tail.png" all find the Oxtail.
 * Anything that does not match is REPORTED rather than guessed at: a photo on
 * the wrong dish is worse than no photo.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync, rmSync } from "node:fs";
import { resolve, dirname, extname, basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IN_DIR = process.env.PHOTO_DIR ?? resolve(process.env.HOME ?? "", "Desktop/flourish-photos");
const OUT_DIR = resolve(ROOT, "public/items");

/* The spec, from docs/DISH-PHOTOS.md. Square because the card is square; 600
   because it renders at 82px and needs to survive a 3x screen; 80KB because a
   614KB image once broke the launch screen and there is a test pinning that. */
const EDGE = 600;
const MAX_BYTES = 80 * 1024;

const { MENU } = await import(resolve(ROOT, "src/data/menu.data.js"));
const items = MENU.flatMap((c) => c.items.map((i) => ({ ...i, cat: c.cat })));

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

/* FOUR DISHES SHARE A NAME WITH THEIR EVERYDAY TWIN, so the name alone cannot
   identify a file. Both Shrimps, both Salmons, both Blue Crabs and both Crab
   Legs Platters exist — one on the everyday menu and one on Seafood Fridays, at
   different prices and with different contents.

   Stripping the parenthetical made all four collide on one filename, which the
   ambiguity check would then refuse — safe, but it means those four could never
   get a photo at all. So a Seafood Fridays dish carries `-friday`. Readable,
   and it matches how staff talk about them. */
const slug = (item) => {
  const base = String(item.name).toLowerCase().replace(/\(.*?\)/g, "").trim()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return item.cat === "Seafood Fridays" ? `${base}-friday` : base;
};

/** What filenames an item answers to. The slug, and the full name as typed. */
const keysFor = (item) => [...new Set([norm(slug(item)), norm(item.name)])].filter(Boolean);

function listNeeded() {
  console.log(`\n  ${items.length} dishes. Name each file after the dish — any punctuation,`);
  console.log("  any case, any extension. Drop them all in:\n");
  console.log(`    ${IN_DIR}\n`);
  let cat = null;
  for (const i of items) {
    if (i.cat !== cat) { cat = i.cat; console.log(`\n  ${cat}`); }
    const have = existsSync(resolve(OUT_DIR, `${slug(i)}.webp`));
    console.log(`    ${have ? "✓" : " "} ${i.name.padEnd(38)} -> ${slug(i)}.<anything>`);
  }
  console.log("");
}

/** Square-crop to EDGE and encode under MAX_BYTES, stepping quality down. */
function convert(src, outPath) {
  const tmp = join(OUT_DIR, `.tmp-${process.pid}.png`);
  try {
    const dims = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", src], { encoding: "utf8" });
    const w = Number(/pixelWidth: (\d+)/.exec(dims)?.[1]);
    const h = Number(/pixelHeight: (\d+)/.exec(dims)?.[1]);
    if (!w || !h) throw new Error("could not read dimensions");

    /* Scale so the SHORT side is EDGE, then centre-crop. Scaling the long side
       instead would letterbox a wide photo into a square with bars, which looks
       like a broken asset rather than a crop. */
    const scale = EDGE / Math.min(w, h);
    const nw = Math.max(EDGE, Math.round(w * scale));
    const nh = Math.max(EDGE, Math.round(h * scale));
    execFileSync("sips", ["-z", String(nh), String(nw), src, "--out", tmp], { stdio: "ignore" });
    execFileSync("sips", ["-c", String(EDGE), String(EDGE), tmp], { stdio: "ignore" });

    for (const q of [82, 74, 66, 58, 50, 42]) {
      execFileSync("cwebp", ["-quiet", "-q", String(q), tmp, "-o", outPath]);
      if (statSync(outPath).size <= MAX_BYTES) return { q, bytes: statSync(outPath).size };
    }
    return { q: 42, bytes: statSync(outPath).size, over: true };
  } finally {
    if (existsSync(tmp)) rmSync(tmp);
  }
}

function run() {
  if (!existsSync(IN_DIR)) {
    console.error(`\n  No such folder: ${IN_DIR}\n  Create it and drop the photos in.\n`);
    process.exit(1);
  }
  mkdirSync(OUT_DIR, { recursive: true });

  const files = readdirSync(IN_DIR)
    .filter((f) => /\.(jpe?g|png|webp|heic|tiff?)$/i.test(f));
  if (!files.length) {
    console.error(`\n  ${IN_DIR} has no images in it yet.\n`);
    process.exit(1);
  }

  /* Build the lookup once, and refuse an ambiguous key rather than picking. */
  /* Two dishes resolving to one filename is a bug in the naming scheme, not a
     thing to work around at match time. Caught here so it cannot recur. */
  const slugs = new Map();
  for (const i of items) {
    const sl = slug(i);
    if (slugs.has(sl)) {
      console.error(`\n  Naming collision: "${slugs.get(sl)}" and "${i.name}" both want ${sl}.webp`);
      console.error("  Fix slug() in this script before going further.\n");
      process.exit(1);
    }
    slugs.set(sl, i.name);
  }

  const byKey = new Map();
  for (const i of items) {
    for (const k of keysFor(i)) {
      if (byKey.has(k) && byKey.get(k).id !== i.id) byKey.set(k, "AMBIGUOUS");
      else byKey.set(k, i);
    }
  }

  const matched = [];
  const unmatched = [];
  for (const f of files) {
    const key = norm(basename(f, extname(f)));
    const hit = byKey.get(key)
      ?? [...byKey.entries()].find(([k, v]) => v !== "AMBIGUOUS" && (k.startsWith(key) || key.startsWith(k)))?.[1];
    if (!hit || hit === "AMBIGUOUS") { unmatched.push(f); continue; }
    matched.push({ file: f, item: hit });
  }

  console.log(`\n  ${matched.length} of ${files.length} file(s) matched a dish.\n`);
  const results = [];
  for (const { file, item } of matched) {
    const out = resolve(OUT_DIR, `${slug(item)}.webp`);
    try {
      const r = convert(resolve(IN_DIR, file), out);
      results.push({ item, path: `/items/${slug(item)}.webp` });
      console.log(
        `    ${item.name.padEnd(36)} ${String(Math.round(r.bytes / 1024)).padStart(3)}KB q${r.q}` +
        (r.over ? "   !! still over 80KB — needs a smaller source" : "")
      );
    } catch (e) {
      console.error(`    ${item.name.padEnd(36)} FAILED — ${e.message}`);
    }
  }

  if (unmatched.length) {
    console.log(`\n  ${unmatched.length} file(s) matched no dish, and were skipped:`);
    for (const f of unmatched) console.log(`    ${f}`);
    console.log("    Rename them after the dish — see --list.");
  }

  const missing = items.filter((i) => !results.some((r) => r.item.id === i.id));
  if (missing.length) {
    console.log(`\n  ${missing.length} dish(es) still have no photo:`);
    for (const i of missing) console.log(`    ${i.name}`);
  }

  writeFileSync(resolve(ROOT, ".photo-map.json"), JSON.stringify(
    Object.fromEntries(results.map((r) => [r.item.id, r.path])), null, 2));
  console.log(`\n  Mapping written. Run with --map to print the ITEM_PHOTOS block.\n`);
}

function printMap() {
  const f = resolve(ROOT, ".photo-map.json");
  if (!existsSync(f)) {
    console.error("\n  No mapping yet — run the conversion first.\n");
    process.exit(1);
  }
  const map = JSON.parse(readFileSync(f, "utf8"));
  const byId = new Map(items.map((i) => [i.id, i]));
  console.log("\nconst ITEM_PHOTOS = {");
  for (const [id, path] of Object.entries(map)) {
    console.log(`  ${JSON.stringify(id)}: ${JSON.stringify(path)},${" ".repeat(Math.max(1, 8))}// ${byId.get(id)?.name ?? "?"}`);
  }
  console.log("};\n");
}

const mode = process.argv[2];
if (mode === "--list") listNeeded();
else if (mode === "--map") printMap();
else run();
