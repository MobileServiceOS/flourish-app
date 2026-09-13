import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { MENU } from "../data/menu.data.js";

/* ============================================================================
   A DISH THAT HAD A PHOTO MUST NOT LOSE IT

   The mapping lives in the generator, keyed by Clover item id, precisely so a
   regeneration cannot drop it — the same reason PREP_MINUTES lives there. This
   is the check that makes that guarantee real rather than intended.

   Note what it does NOT assert: that any item HAS a photo. None do yet, and an
   emoji tile is a supported state rather than a missing asset. What it catches
   is the regression: an id present in ITEM_PHOTOS whose item comes out of a
   regeneration with no `img`, or an `img` pointing at a file that is not there.
   ============================================================================ */

const ROOT = resolve(process.cwd());
const gen = readFileSync(resolve(ROOT, "scripts/generate-menu.mjs"), "utf8");
const items = MENU.flatMap((c) => c.items);

/** The declared mapping, read from the generator source. */
const declared = (() => {
  const start = gen.indexOf("const ITEM_PHOTOS = {");
  const block = gen.slice(start, gen.indexOf("\n};", start));
  return Object.fromEntries(
    [...block.matchAll(/"([A-Z0-9]{10,})"\s*:\s*"([^"]+)"/g)].map((m) => [m[1], m[2]])
  );
})();

describe("dish photos survive a regeneration", () => {
  it("keeps the mapping in the generator, not in the generated file", () => {
    /* menu.data.js is rewritten wholesale on every run. Anything that has to
       outlive that belongs in the generator, keyed by Clover id. */
    expect(gen).toMatch(/const ITEM_PHOTOS = \{/);
    expect(gen).toMatch(/ITEM_PHOTOS\[it\.id\]/);
  });

  it("gives every declared item an img in the generated data", () => {
    /* The regression this file exists for. An id declared here whose item comes
       out without an `img` means the emission was dropped. */
    for (const [id, path] of Object.entries(declared)) {
      const item = items.find((i) => i.id === id);
      if (!item) continue;            // delisted or hidden: not a photo problem
      expect(item.img, `${item.name} (${id}) lost its photo`).toBe(path);
    }
  });

  it("points every declared path at a file that exists", () => {
    // A path with no file renders a broken image where an emoji was fine.
    for (const [id, path] of Object.entries(declared)) {
      const onDisk = resolve(ROOT, "public", path.replace(/^\//, ""));
      expect(existsSync(onDisk), `${id} -> ${path} is not on disk`).toBe(true);
    }
  });

  it("falls back to an emoji rather than a placeholder image", () => {
    /* Every item must be renderable. A photo is optional; something to show is
       not. The card reads `img` first and the emoji second. */
    for (const i of items) {
      expect(typeof i.emoji, i.name).toBe("string");
      expect(i.emoji.length, i.name).toBeGreaterThan(0);
    }
  });

  it("never points at an external host", () => {
    /* The predecessor built DoorDash CDN URLs out of Clover ids, which 403'd on
       every item and fired 43 failed cross-origin requests per render. Photos
       are served from public/ or not at all. */
    for (const path of Object.values(declared)) {
      expect(path, path).toMatch(/^\/items\//);
      expect(path).not.toMatch(/^https?:/);
    }
    for (const i of items) {
      if (i.img) expect(i.img).toMatch(/^\/items\//);
    }
  });
});
