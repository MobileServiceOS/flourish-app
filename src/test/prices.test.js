import { describe, it, expect } from "vitest";
import { MENU } from "../data/menu.data.js";

const all = MENU.flatMap((c) => c.items);
const item = (name) => all.find((i) => i.name === name);
const opts = (name) => {
  const g = item(name).groups.find((x) => x.kind === "variant");
  return Object.fromEntries(g.mods.map((m) => [m.n, m]));
};

/* The printed menu is the price authority. These are the nine places Clover
   disagreed; each one is pinned so a careless regen cannot quietly undo it. */

describe("printed menu prices", () => {
  it("charges menu prices for pork, not Clover's cheaper ones", () => {
    const o = opts("Pork");
    expect(o["Medium Stew"].p).toBe(20);
    expect(o["Large Stew"].p).toBe(25);
    expect(o["Medium Jerk"].p).toBe(20);
    expect(o["Large Jerk"].p).toBe(25);
    expect([item("Pork").lo, item("Pork").hi]).toEqual([20, 25]);
  });

  it("prices pasta from the menu", () => {
    const o = opts("Pasta");
    expect(o["Penne Alla Vodka"].p).toBe(18);
    expect(o["Oxtail"].p).toBe(24);       // Clover had it a dollar dearer
  });

  it("rounds the odd-cent items to the menu's whole numbers", () => {
    expect(opts("Side")["Chicken Mac & Cheese"].p).toBe(7);
    expect(item("Chicken & Waffles").base).toBe(15);
    expect(item("Chicken & Waffles").lo).toBe(15);
    for (const n of ["Curried Chicken", "Fried Chicken", "Jerk Chicken", "Stew Chicken"]) {
      expect(opts("Lunch Specials")[n].p).toBe(8);
    }
  });

  it("leaves salmon at $22, which both sources agree on", () => {
    const salmon = item("Salmon");
    expect([salmon.lo, salmon.hi]).toEqual([22, 22]);
    for (const m of salmon.groups.find((g) => g.kind === "variant").mods) {
      expect(m.p).toBe(22);
    }
  });
});

describe("only what the printed menu sells", () => {
  it("hides the options that are on the register but not the menu", () => {
    /* Whiting Fish ($14 full meal) and the $20 snapper add-on stay hidden: the
       price claims check out against live Clover and each sold once in 600
       orders. */
    expect(opts("Snapper Fish")["Whiting Fish"].oos).toBe(true);
    expect(opts("Snapper Fish")["Snapper Fish (Add On. No Sides)"].oos).toBe(true);
  });

  it("sells the lunch specials the register says people order", () => {
    /* Curry Goat, Oxtail and Wings were hidden as "the menu does not list
       them". Wings alone sold 185 times in 600 orders — the most-ordered item
       in the sample — so the exclusion was costing real orders and the printed
       menu is the stale document. They also sell 10:00-21:00, so this is a
       price tier and not a lunchtime window the app would have to model.
       See docs/HIDE-REASONS-AUDIT.md. */
    for (const n of ["Curry Goat", "Oxtail", "Wings"]) {
      expect(opts("Lunch Specials")[n].oos, n).toBeUndefined();
    }
  });

  it("keeps a hidden option out of the advertised price range", () => {
    // Whiting Fish $14 and the $20 "add on, no sides" both came off the menu,
    // so fish is the flat $30 the menu prints
    expect([item("Snapper Fish").lo, item("Snapper Fish").hi]).toEqual([30, 30]);
    /* Lunch Specials runs to $13.50 now that Oxtail is sellable again — the
       range follows what can be bought, so un-hiding an option raises it. */
    expect([item("Lunch Specials").lo, item("Lunch Specials").hi]).toEqual([2, 13.5]);
  });
});

describe("every advertised range matches what can actually be bought", () => {
  it("holds for all 42 items", () => {
    const wrong = [];
    for (const it of all) {
      const g = it.groups.find((x) => x.kind === "variant");
      if (!g) {
        if (it.lo !== it.base || it.hi !== it.base) wrong.push(it.name);
        continue;
      }
      const ps = g.mods.filter((m) => !m.oos && m.p > 0).map((m) => m.p);
      if (!ps.length) continue;
      if (Math.min(...ps) !== it.lo || Math.max(...ps) !== it.hi) wrong.push(it.name);
    }
    expect(wrong).toEqual([]);
  });

  it("never sets a range boundary that only a hidden option could reach", () => {
    // A hidden option may share a price with a visible one — salmon hides two
    // flavours that cost the same $22 as the three it sells, and that is fine.
    // What must never happen is lo or hi being reachable ONLY by something
    // the customer cannot pick.
    for (const it of all) {
      const g = it.groups.find((x) => x.kind === "variant");
      if (!g) continue;
      const visible = g.mods.filter((m) => !m.oos && m.p > 0).map((m) => m.p);
      if (!visible.length) continue;
      expect(visible, it.name).toContain(it.lo);
      expect(visible, it.name).toContain(it.hi);
    }
  });
});

/* Straight off the printed trifold. */
describe("what the printed menu actually says", () => {
  it("has no goat head soup left to price", () => {
    /* Three states in sequence, and the reason matters more than the result.
       It was priced here ($5/$10 over Clover's $0) so the app could sell a dish
       the register gave away; then hidden, when the shop decided it was a
       counter-only dish and the app stopped papering over the $0; and now the
       two sizes have been DELETED from the Soup group at the register, so there
       is neither a price to override nor an option to hide. */
    const o = opts("Soup");
    expect(Object.keys(o).filter((n) => /goat/i.test(n))).toEqual([]);
  });

  it("sells the salmon flavours people actually order", () => {
    const o = opts("Salmon");
    // Steamed: 0 sales in 600 orders, and not on the printed menu. Stays hidden.
    expect(o["Steamed"].oos).toBe(true);
    // Jerk: 25 sales. Un-hidden after the audit.
    expect(o["Jerk"].oos).toBeUndefined();
    for (const n of ["Sweet Chili", "Grilled", "Honey Garlic"]) {
      expect(o[n].oos).toBeUndefined();
    }
  });

  it("does not advertise a flavour it will not sell", () => {
    /* The copy read "...grilled, or steamed" while Steamed was hidden, so the
       row promised something the sheet would not offer. */
    expect(item("Salmon").desc.toLowerCase()).not.toContain("steamed");
    for (const n of ["honey garlic", "jerk", "sweet chili", "grilled"]) {
      expect(item("Salmon").desc.toLowerCase(), n).toContain(n);
    }
  });

  it("sells every shrimp flavour, fried included", () => {
    /* Fried was flagged off-menu on the grounds that the printed trifold does
       not list it. The shop sells fried shrimp: it is a real flavour inside the
       Shrimp item's own group, and hiding it lost a dish. There is no separate
       Fried Shrimp item in Clover and there should not be one. */
    const o = opts("Shrimp");
    for (const n of ["Sweet Chili", "Grilled", "Pepper", "Garlic", "Curried", "Fried"]) {
      expect(o[n].oos, n).toBeUndefined();
    }
  });

  it("prices fish at the flat $30 the menu prints", () => {
    const fish = item("Snapper Fish");
    expect([fish.lo, fish.hi]).toEqual([30, 30]);
    for (const n of ["Brown Stew Fish", "Escovitch", "Steam Fish"]) {
      expect(opts("Snapper Fish")[n].p).toBe(30);
    }
  });

  it("matches the menu on every chicken and meat plate", () => {
    expect([item("Brown Stew Chicken").lo, item("Brown Stew Chicken").hi]).toEqual([13, 15]);
    expect([item("Fried chicken").lo, item("Fried chicken").hi]).toEqual([13, 16]);
    expect([item("Jerk Chicken").lo, item("Jerk Chicken").hi]).toEqual([14, 16]);
    expect([item("Wings").lo, item("Wings").hi]).toEqual([15, 18]);
    expect(item("Lamb").base).toBe(30);
    expect([item("Oxtail").lo, item("Oxtail").hi]).toEqual([20, 25]);
    expect([item("Curried Goat").lo, item("Curried Goat").hi]).toEqual([15, 18]);
    expect([item("Stew Peas").lo, item("Stew Peas").hi]).toEqual([15, 18]);
  });

  it("matches the menu on pasta and shellfish", () => {
    const p = opts("Pasta");
    expect(p["Plain Pasta"].p).toBe(15);
    expect(p["Garlic"].p).toBe(15);
    expect(p["Chicken"].p).toBe(18);
    expect(p["Penne Alla Vodka"].p).toBe(18);
    expect(p["Shrimp"].p).toBe(20);
    expect(p["Oxtail"].p).toBe(24);
    expect(p["Steak"].p).toBe(25);
    expect(item("Lobster").base).toBe(45);
    expect(item("Crab Legs Platter").base).toBe(50);
  });

  it("matches the menu on every side it lists", () => {
    const s = opts("Side");
    const menu = {
      "Fried Chicken": 6, "Rice & Peas": 5, "White Rice": 5, "Mac & Cheese": 6,
      "Seafood Mac & Cheese": 8, "Chicken Mac & Cheese": 7, "Waffles": 8,
      "Mashed Potatoes": 5, "Steam Veggies": 3, "Festival": 1, "Pasta": 10,
      "Shrimp": 5, "Corn Bread": 1.5,
    };
    for (const [name, price] of Object.entries(menu)) {
      expect(s[name], name).toBeDefined();
      expect(s[name].p, name).toBe(price);
    }
  });
});
