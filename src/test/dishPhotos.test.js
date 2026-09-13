import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { MENU } from "../data/menu.data.js";

/* ============================================================================
   A DISH THAT HAD A PHOTO MUST NOT LOSE IT

   The mapping lives in the generator, keyed by Clover item id, precisely so a
   regeneration cannot drop it — the same reason PREP_MINUTES lives there. This
   is the check that makes that guarantee real rather than intended.

   Note what it does NOT assert: that any item HAS a photo. Most do not, and an
   emoji tile is a supported state rather than a missing asset. What it catches
   is the regression: an id present in ITEM_PHOTOS whose item comes out of a
   regeneration with no `img`, or an `img` pointing at a file that is not there.

   And the one that costs money: FOUR DISHES SHARE A NAME WITH A FRIDAY TWIN at
   a different price — both Shrimps, both Salmons, both Blue Crabs, both Crab
   Legs Platters. A photo on the wrong one advertises a $21.99 platter over a
   $22.00 plate, or the reverse. The last two tests here make that a failure
   rather than something somebody notices on a phone.
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

  it("gives a photo to at most one of two dishes sharing a name", () => {
    /* The collision that matters. `Shrimp` exists twice — everyday $20 and
       Friday $21.99 — and the photos in hand are of the everyday dishes,
       identified by a flavour only the everyday items have. Two items with one
       name and one photo between them is correct; two photos would mean
       somebody guessed. */
    const base = (n) => n.replace(/\(.*?\)/g, "").trim().toLowerCase();
    const byBase = new Map();
    for (const i of items) {
      if (!byBase.has(base(i.name))) byBase.set(base(i.name), []);
      byBase.get(base(i.name)).push(i);
    }
    for (const [name, group] of byBase) {
      if (group.length < 2) continue;
      const withPhoto = group.filter((i) => i.img);
      expect(withPhoto.length, `${group.length} dishes named "${name}" and ${withPhoto.length} photos`)
        .toBeLessThanOrEqual(1);
    }
  });

  it("never puts a Friday photo on an everyday price, or the reverse", () => {
    /* The slug carries `-friday` for a Seafood Fridays dish precisely so the
       two can never resolve to one filename. That naming is only a guarantee
       while the category and the filename agree, which is what this checks. */
    for (const c of MENU) {
      for (const i of c.items) {
        if (!i.img) continue;
        const isFridayFile = /-friday\.webp$/.test(i.img);
        expect(isFridayFile, `${i.name} is in ${c.cat} but its photo is ${i.img}`)
          .toBe(c.cat === "Seafood Fridays");
      }
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

/* ============================================================================
   THE GENERATOR WRITES LAST

   The under-quote guard prints "Nothing was written" and exits before the
   write, which was verified by forcing it. That verification was incomplete:
   150 lines of further checks ran AFTER writeFileSync, so any of them throwing
   left menu.data.js on disk in a state nothing had finished validating — while
   the run exited non-zero and the file looked fine.

   It happened. The photo check read `ids` twenty lines above its `const`, a
   temporal dead zone and a hard ReferenceError. It was harmless while
   ITEM_PHOTOS was empty (the loop body never ran) and fired the moment twelve
   photos were added — after the file had been written.

   So: every check runs first, the write is last, and this is the test that
   keeps it that way. "Nothing was written" has to be true when it is printed.
   ============================================================================ */
describe("the generator cannot write before it has finished checking", () => {
  const src = readFileSync(resolve(ROOT, "scripts/generate-menu.mjs"), "utf8");

  it("writes the file exactly once", () => {
    expect(src.match(/writeFileSync\(OUT, js\)/g) ?? []).toHaveLength(1);
  });

  it("has nothing but logging after the write", () => {
    /* Anything else here can throw, and a throw after the write is the whole
       failure mode. Logging cannot fail in a way that matters. */
    const after = src.slice(src.indexOf("writeFileSync(OUT, js)"))
      .split("\n").slice(1)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("//") && !l.startsWith("/*") && !l.startsWith("*"));

    for (const line of after) {
      expect(line, `"${line}" runs after the write and could leave an unchecked file`)
        .toMatch(/^(console\.(log|warn|error)|for \(const cat of CATEGORY_ORDER\) console\.log)/);
    }
  });

  it("declares `ids` before the checks that read it", () => {
    /* The exact bug: `const` is block-scoped with a dead zone, so a read above
       the declaration is a ReferenceError rather than an undefined. */
    const decl = src.indexOf("const ids = new Set(");
    expect(decl).toBeGreaterThan(-1);
    const firstUse = src.indexOf("ids.has(");
    expect(firstUse).toBeGreaterThan(decl);
  });

  it("still refuses to write when an override would quote under the register", () => {
    // The original guarantee, re-pinned now that the ordering has changed.
    const guard = src.indexOf("Nothing was written");
    const write = src.indexOf("writeFileSync(OUT, js)");
    expect(guard).toBeGreaterThan(-1);
    expect(guard, "the guard must still come before the write").toBeLessThan(write);
  });
});
