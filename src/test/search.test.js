import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MENU } from "../data/menu.data.js";
import {
  normalise, queryTokens, matchesQuery, rankFor, preselectFor, searchItems,
} from "../lib/search.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ALL = MENU.flatMap((c) => c.items);
const find = (q) => searchItems(ALL, q).map((i) => i.name);
const item = (name) => ALL.find((i) => i.name === name);

/* ============================================================================
   SEARCHING FOR THE DISH, NOT THE ROW

   Customers search for what they want to eat. "sweet chili salmon",
   "escovitch", "honey garlic" are every one of them a MODIFIER, and a search
   that only looked at item names returned nothing for all of them.
   ============================================================================ */

describe("modifier text is searchable", () => {
  it("finds Salmon from a flavour that only exists in its modifier group", () => {
    expect(find("sweet chili salmon")).toEqual(["Salmon"]);
    expect(find("honey garlic salmon")).toEqual(["Salmon"]);
  });

  it("finds the fish from escovitch, which appears nowhere in a name", () => {
    expect(find("escovitch")).toEqual(["Snapper Fish"]);
  });

  it("finds the Shrimp plate through Fried, which is a real flavour of it", () => {
    /* Fried was wrongly flagged off-menu, so this query used to reach Shrimp
       only by accident, through the "Fried Chicken" side every plate carries.
       That path is gone now — the shared sides are not indexed — so this
       passing means the flavour itself matched. */
    const shrimp = item("Shrimp");
    const flavours = shrimp.groups.find((g) => g.gid === "4BY3GKC2SVJ90");
    expect(flavours.mods.find((m) => m.n === "Fried").oos).toBeUndefined();
    expect(shrimp.search).toContain("fried");
    expect(find("fried shrimp")[0]).toBe("Shrimp");
  });

  it("opens the Shrimp sheet on Fried when that is what was searched", () => {
    const shrimp = item("Shrimp");
    const flavours = shrimp.groups.find((g) => g.gid === "4BY3GKC2SVJ90");
    const sel = preselectFor(shrimp, "fried shrimp");
    expect(flavours.mods[sel[flavours.gid]].n).toBe("Fried");
  });

  it("does not care what order the words come in", () => {
    expect(find("fried shrimp")).toEqual(find("shrimp fried"));
    expect(find("sweet chili salmon")).toEqual(find("salmon sweet chili"));
    expect(find("salmon chili sweet")).toEqual(find("sweet chili salmon"));
  });

  it("needs every word, so a query is narrowed rather than widened", () => {
    // AND, not OR: "sweet chili salmon" must not return everything with chili
    // plus everything with salmon.
    expect(find("sweet chili salmon").length).toBe(1);
    /* A broad word has to match several for the narrowing to mean anything.
       "salmon" matched two until the Friday duplicate was hidden from the app,
       leaving one — so this uses a word that still spans the menu. */
    expect(find("shrimp").length).toBeGreaterThan(1);
  });
});

describe("case, punctuation and whitespace are noise", () => {
  it("matches whatever the customer types", () => {
    const expected = find("mac and cheese");
    for (const q of ["MAC AND CHEESE", "Mac & Cheese", "  mac   and cheese  ", "mac&cheese"]) {
      expect(find(q), q).toEqual(expected);
    }
  });

  it("normalises to lowercase words", () => {
    expect(normalise("  Sweet   CHILI!  ")).toBe("sweet chili");
    expect(normalise("Mac & Cheese")).toBe("mac cheese");
  });

  it("drops joining words that would match almost everything", () => {
    // "and" is in half the item names; as a search token it is pure noise.
    expect(queryTokens("mac and cheese")).toEqual(["mac", "cheese"]);
    expect(queryTokens("  ")).toEqual([]);
  });
});

describe("an exact item name outranks a modifier match", () => {
  it("leads with the Shrimp plate, not every plate offering shrimp", () => {
    const results = find("shrimp");
    expect(results[0]).toBe("Shrimp");
    expect(results.length).toBeGreaterThan(1);   // the others still come back
  });

  it("scores an exact name above everything else", () => {
    expect(rankFor(item("Shrimp"), "shrimp")).toBe(0);
    expect(rankFor(item("Ackee & Shrimp"), "shrimp"))
      .toBeGreaterThan(rankFor(item("Shrimp"), "shrimp"));
  });

  it("prefers the plate whose whole name is the query over a longer one", () => {
    // "Shrimp" beats "Shrimp & Waffles" for a query that never said waffles.
    expect(rankFor(item("Shrimp & Waffles"), "fried shrimp"))
      .toBeGreaterThan(rankFor(item("Shrimp"), "fried shrimp"));
  });

  it("keeps the standalone Side item first, as the earlier fix required", () => {
    expect(find("side")[0]).toBe("Side");
    expect(find("Side")[0]).toBe("Side");
  });

  it("ranks a description-only match below a real modifier match", () => {
    // Same query, two items: Drink sells coconut water, Stew Peas merely
    // mentions coconut milk in its copy.
    expect(rankFor(item("Stew Peas"), "coconut"))
      .toBeGreaterThan(rankFor(item("Drink"), "coconut"));
    expect(find("coconut")[0]).toBe("Drink");
  });
});

describe("the shared sides are not searchable", () => {
  /* The same fourteen options sit on some twenty plates, so matching one said
     nothing about which plate was wanted: "mac and cheese" returned twenty
     rows. Sides are sold separately, so the standalone Side item is where they
     are found now. */
  it("does not surface a plate through the sides it comes with", () => {
    expect(find("white rice")).toEqual(["Side"]);
    expect(find("mac and cheese")).toEqual(["Side"]);
  });

  it("does not surface a plate through a side upcharge either", () => {
    expect(find("candied yams")).toEqual(["Side"]);
  });

  it("keeps a side word matching the item that actually sells it", () => {
    expect(item("Side").search).toContain("mac");
    expect(item("Side").search).toContain("rice");
  });
});

describe("sold-out and off-menu modifiers never match", () => {
  it("does not surface Salmon through Steamed, which is off the menu", () => {
    // Surfacing a plate through a flavour we refuse to sell is worse than not
    // matching: the customer taps the row and the option is not on the sheet.
    expect(find("steamed salmon")).toEqual([]);
  });

  it("DOES surface Salmon through Jerk, which sells 25 times in 600 orders", () => {
    /* Jerk was hidden as "a flavour the printed menu does not list". The
       register disagreed loudly, so it is sellable now and search must find it.
       See docs/HIDE-REASONS-AUDIT.md. */
    expect(find("jerk salmon")).toContain("Salmon");
  });

  it("still matches the same word where it IS sellable", () => {
    expect(find("steamed")).toContain("Snapper Fish");
    expect(find("jerk chicken")[0]).toBe("Jerk Chicken");
  });

  it("keeps oos words out of the generated index", () => {
    const salmon = item("Salmon");
    expect(salmon.search).toContain("sweet");
    expect(salmon.search).toContain("honey");
    expect(salmon.search).not.toContain("steamed");   // still off the menu
    expect(salmon.search).toContain("jerk");          // un-hidden after the audit
  });

  it("does not let a stale description put an oos flavour back", () => {
    /* Snapper Fish's copy reads "Brown stew, escovitch, or steamed" and its
       group's Steam Fish IS sellable, so that one is fine. The rule is tested
       on Salmon instead, whose copy used to promise steamed while the option
       was hidden — the copy has since been corrected, so this asserts BOTH
       halves: the description no longer over-promises, and the matcher would
       not honour it even if it did. */
    expect(item("Salmon").desc.toLowerCase()).not.toContain("steamed");
    expect(matchesQuery(item("Salmon"), "steamed")).toBe(false);
  });
});

describe("a query that matches nothing returns nothing", () => {
  it("returns empty, not the whole menu", () => {
    expect(find("zzzz")).toEqual([]);
    expect(find("wagyu ribeye")).toEqual([]);
    expect(find("sweet chili oxtail")).toEqual([]);   // both words exist, not together
  });

  it("returns everything only for an empty query", () => {
    expect(searchItems(ALL, "")).toHaveLength(ALL.length);
    expect(searchItems(ALL, "   ")).toHaveLength(ALL.length);
  });
});

describe("the sheet opens on what was searched for", () => {
  it("preselects sweet chili when that is what was asked for", () => {
    const salmon = item("Salmon");
    const sel = preselectFor(salmon, "sweet chili salmon");
    const group = salmon.groups.find((g) => g.gid === "ZR29AF0E4JPXA");

    expect(sel[group.gid]).toBeGreaterThanOrEqual(0);
    expect(group.mods[sel[group.gid]].n).toBe("Sweet Chili");
  });

  it("preselects honey garlic for a different query on the same item", () => {
    const salmon = item("Salmon");
    const sel = preselectFor(salmon, "honey garlic salmon");
    const group = salmon.groups.find((g) => g.gid === "ZR29AF0E4JPXA");
    expect(group.mods[sel[group.gid]].n).toBe("Honey Garlic");
  });

  it("prefers the option that accounts for more of the query", () => {
    // "Sweet Chili" covers two words; "Grilled" covers none.
    const salmon = item("Salmon");
    const group = salmon.groups.find((g) => g.gid === "ZR29AF0E4JPXA");
    const sel = preselectFor(salmon, "sweet chili");
    expect(group.mods[sel[group.gid]].n).toBe("Sweet Chili");
  });

  it("never preselects an oos option", () => {
    // Steamed is still off the menu, so it must not be preselected.
    expect(preselectFor(item("Salmon"), "steamed salmon")).toEqual({});
  });

  it("does preselect Jerk, now that it is sellable again", () => {
    const salmon = item("Salmon");
    const sel = preselectFor(salmon, "jerk");
    const group = salmon.groups.find((g) => g.kind === "variant");
    expect(sel[group.gid]).toBeGreaterThanOrEqual(0);
    expect(group.mods[sel[group.gid]].n).toBe("Jerk");
  });

  it("leaves the sides alone", () => {
    /* A side is what comes WITH the plate. Silently swapping someone's rice
       because a search word brushed against it is not a search box's call. */
    const salmon = item("Salmon");
    const sel = preselectFor(salmon, "mac cheese salmon");
    const sideGroup = salmon.groups.find((g) => g.kind === "side");
    expect(sel[sideGroup.gid]).toBeUndefined();
  });

  it("preselects nothing without a query", () => {
    expect(preselectFor(item("Salmon"), "")).toEqual({});
    expect(preselectFor(item("Salmon"), "   ")).toEqual({});
  });
});

/* ============================================================================
   THE INDEX IS GENERATED, NEVER HAND-MAINTAINED

   It comes out of the Clover export, so renaming a flavour in Clover renames it
   in search on the next regeneration. This is what proves the committed data
   still matches what the generator would produce — a hand edit, a stale file or
   a drifting normalise() all fail here.
   ============================================================================ */
describe("the search index regenerates from the Clover export", () => {
  const gen = readFileSync(resolve(HERE, "../../scripts/generate-menu.mjs"), "utf8");

  /* Recomputed with THIS file's normalise(), against the committed data. If the
     generator's copy of the rules drifts from lib/search.js, this diverges. */
  const rebuild = (it) => {
    const words = [];
    const seen = new Set();
    const add = (text) => {
      for (const w of normalise(text).split(" ")) {
        if (w && !seen.has(w)) { seen.add(w); words.push(w); }
      }
    };
    add(it.name);
    for (const g of it.groups) {
      if (g.kind === "side") continue;          // the shared sides are not indexed
      for (const m of g.mods) {
        if (m.oos) continue;
        add(m.n);
      }
    }
    return words.join(" ");
  };

  it("gives every item an index", () => {
    for (const it of ALL) {
      expect(typeof it.search, `${it.name} (${it.id})`).toBe("string");
      expect(it.search.length).toBeGreaterThan(0);
    }
  });

  it("matches what the generator's rules produce, item for item", () => {
    for (const it of ALL) {
      expect(it.search, `${it.name} (${it.id}) has drifted`).toBe(rebuild(it));
    }
  });

  it("indexes the item name and every sellable dish-defining modifier", () => {
    const salmon = item("Salmon");
    expect(salmon.search).toContain("salmon");
    for (const g of salmon.groups) {
      if (g.kind === "side") continue;
      for (const m of g.mods) {
        if (m.oos) continue;
        for (const w of normalise(m.n).split(" ")) {
          expect(salmon.search, `${m.n} missing from index`).toContain(w);
        }
      }
    }
  });

  it("leaves the shared sides group out", () => {
    /* The same fourteen options sit on some twenty plates. Indexing them made
       any query with a side word in it match nearly the whole menu. */
    const salmon = item("Salmon");
    const sideGroup = salmon.groups.find((g) => g.kind === "side");
    expect(sideGroup).toBeTruthy();
    expect(sideGroup.mods.some((m) => m.n === "White Rice")).toBe(true);
    expect(salmon.search).not.toContain("white rice");
    expect(salmon.search).not.toContain("candied");

    // ...but the standalone Side item keeps its own, because sides are sold
    // separately and "mac and cheese" has to find them somewhere.
    expect(item("Side").search).toContain("mac");
    expect(item("Side").search).toContain("cheese");
  });

  it("skips the shared sides in the generator, not just in the data", () => {
    expect(gen).toMatch(/if \(g\.kind === "side"\) continue;/);
  });

  it("is emitted by the generator, not written in by hand", () => {
    // The template that writes each item line has to carry the field, or the
    // next regeneration drops every index on the floor.
    expect(gen).toMatch(/search: \$\{q\(searchIndex\(i\)\)\}/);
    expect(gen).toMatch(/\$\{prep\}\$\{search\}, groups:/);
    expect(gen).toMatch(/function searchIndex\(/);
    // ...and it must skip oos modifiers while doing so.
    expect(gen).toMatch(/if \(mod\.oos\) continue;/);
  });

  it("keeps the generator's normalise in step with the app's", () => {
    /* Two copies of one rule, in two files that cannot import each other. This
       is what catches them disagreeing. */
    const genNormalise = /const normaliseSearch = \(s\) =>([\s\S]*?);\n/.exec(gen)[1];
    expect(genNormalise).toContain("toLowerCase()");
    expect(genNormalise).toContain("[^a-z0-9]+");
    expect(genNormalise).toContain("trim()");
    expect(genNormalise).not.toContain('" and "');
  });
});
