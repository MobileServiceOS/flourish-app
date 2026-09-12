import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MENU } from "../data/menu.data.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const gen = readFileSync(resolve(ROOT, "scripts/generate-menu.mjs"), "utf8");
const slice = (start, end) => { const a = gen.indexOf(start); return gen.slice(a, gen.indexOf(end, a)); };

const items = MENU.flatMap((c) => c.items);
const byId = (id) => items.find((i) => i.id === id);
const groupNames = (i) => (i?.groups ?? []).map((g) => g.name);

const MEAL_GROUP_GID = "YQWN3PKBKV9NG";   // Side With Meal
const STANDALONE_GID = "S032100JQ3P4T";   // Side, sold on its own

/* ============================================================================
   THE WRONG SIDE GROUP

   "Side With Meal" and "Side" are two different Clover objects with the same
   word on the dashboard. The meal group prices an included side at $0; the
   standalone group prices it as a thing you buy by itself — White Rice $5,
   Mac & Cheese $6, and Pepper Shrimp at $15 sitting in the list.

   Ten items got the standalone one attached. Clover ADDS a modifier to an
   item's base price, so a $39.99 platter now rings $44.99 with white rice on a
   flyer that says two sides are included — and on the app's side, a base price
   plus a priced group is the double-ring shape, so the generator zeroes the
   base and the platter came out advertised "from $1", priced off its corn
   bread. Wrong in both directions at once.

   So the generator drops that group from those items, and they keep the shape
   they had before: real price, no side picker, until the right group is
   attached at the register.
   ============================================================================ */

const declared = Object.fromEntries(
  [...slice("const MISATTACHED_SIDE_GROUP = {", "};").matchAll(/"([A-Z0-9]+)":\s*"([^"]*)"/g)]
    .map((m) => [m[1], m[2]])
);

describe("the mis-attached side group is declared, not silently swallowed", () => {
  it("is empty, because the register was fixed", () => {
    /* This asserted the map had entries, which was right while the problem was
       live and is now the one thing that would fail for a good reason. All ten
       items carry `Side With Meal`; the generator reported every entry as no
       longer applicable, and they were removed.

       The assertion that still earns its keep is the reverse one — that nothing
       is silently swallowed — and it is in "the map cannot outlive the problem"
       below, which holds for an empty map too. */
    expect(Object.keys(declared)).toEqual([]);
  });

  it("gives each one a reason a human can read", () => {
    for (const [id, why] of Object.entries(declared)) expect(why, id).toBeTruthy();
  });
});

describe("the affected plates keep their real price", () => {
  /* The five the app actually renders. The other five ids in the map are
     delisted or hidden, so they never reach the menu data at all. */
  const PRICED = {
    BRMP82TR0Z45C: 39.99,   // Crab Legs Platter (Shrimp & 2 Sides)
    A1YZ2ZD5CA1SW: 39.99,   // Lobster Platter (Shrimp & 2 Sides)
    "32VDQ4G5J131P": 30,    // Seafood Stew Peas
    DH0P3NGRN9RNE: 15,      // Blue Crab, the Friday one
    PH221AJ7W66EA: 17,      // Pepper Shrimp & Mussels
  };

  for (const [id, price] of Object.entries(PRICED)) {
    it(`${id} still shows $${price}, not a side's price`, () => {
      const item = byId(id);
      expect(item, id).toBeTruthy();
      expect(item.base, `${item.name} base`).toBe(price);
      expect(item.lo, `${item.name} lo`).toBe(price);
      expect(item.hi, `${item.name} hi`).toBe(price);
    });
  }

  it("offers no sides at all on them, rather than the wrong ones", () => {
    for (const id of Object.keys(PRICED)) {
      expect(groupNames(byId(id)), byId(id).name).not.toContain("Side");
    }
  });

  it("never puts a standalone-priced side in front of a plate", () => {
    /* The standalone group belongs to exactly one item: the standalone Side.
       Anywhere else it is the mistake this whole file is about. */
    const wrong = items
      .filter((i) => (i.groups ?? []).some((g) => g.gid === STANDALONE_GID))
      .filter((i) => i.name !== "Side")
      .map((i) => `${i.name} (${i.id})`);
    expect(wrong).toEqual([]);
  });
});

describe("the map cannot outlive the problem", () => {
  it("drops an item the moment it has the right group instead", () => {
    /* If the register is fixed and the id is left here, the item would lose a
       side picker it now legitimately has. The generator pushes an issue in
       that case; this asserts the data agrees — nothing in the map has the
       meal group. */
    for (const id of Object.keys(declared)) {
      const item = byId(id);
      if (!item) continue;   // delisted or hidden; not rendered either way
      const gids = (item.groups ?? []).map((g) => g.gid);
      expect(gids, `${item.name} now HAS Side With Meal — remove it from MISATTACHED_SIDE_GROUP`)
        .not.toContain(MEAL_GROUP_GID);
    }
  });

  it("reports it loudly on every run rather than fixing it quietly", () => {
    expect(gen).toMatch(/WRONG SIDE GROUP at the register/);
    expect(gen).toMatch(/remove \\"Side\\", add \\"Side With Meal\\"/i);
  });
});

/* ============================================================================
   A CATEGORY IS NOT INHERITED FROM THE ROW ABOVE

   Clover blanks most columns on the continuation rows of a multi-group item,
   so those values have to carry forward. They used to carry forward across
   item boundaries too — and this export has 15 items with no category of their
   own, which arrived in the app filed under Lunch & Dinner because the row
   above the first porridge was a beef patty. $0.00 plates, fifteen-minute prep
   defaults, no descriptions, on the menu.
   ============================================================================ */

describe("an item with no category of its own does not inherit one", () => {
  it("resets the carried values when a new Clover ID appears", () => {
    const block = slice("/* ---------- items (a Clover item spans several rows", "/* ---------- build");
    expect(block).toMatch(/if \(r\["Clover ID"\]\)/);
    // The carry must be an assignment, not a `??` that keeps the old value.
    expect(block).toMatch(/id = r\["Clover ID"\];\s*\n\s*name = r\["Name"\];/);
  });

  it("kept the breakfast items off the menu", () => {
    const breakfasty = /porridge|saltfish|ackee n|callao|cornbeef|fry dumpling|fritter/i;
    expect(items.filter((i) => breakfasty.test(i.name)).map((i) => i.name)).toEqual([]);
  });

  it("has no $0.00 item anywhere on the menu", () => {
    /* The shape the leak produced. A plate at $0 rings up free at the register,
       which is the single most expensive kind of bad data here. */
    expect(items.filter((i) => !(i.lo > 0)).map((i) => `${i.name} (${i.id})`)).toEqual([]);
  });
});
