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
    expect(opts("Snapper Fish")["Whiting Fish"].oos).toBe(true);
    for (const n of ["Curry Goat", "Oxtail", "Wings"]) {
      expect(opts("Lunch Specials")[n].oos).toBe(true);
    }
  });

  it("keeps a hidden option out of the advertised price range", () => {
    // Whiting Fish $14 and the $20 "add on, no sides" both came off the menu,
    // so fish is the flat $30 the menu prints
    expect([item("Snapper Fish").lo, item("Snapper Fish").hi]).toEqual([30, 30]);
    // Curry Goat $12 / Oxtail $13.50 / Wings $10.50 used to set the top
    expect([item("Lunch Specials").lo, item("Lunch Specials").hi]).toEqual([2, 8]);
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
  it("prices goat head soup, which Clover had at $0 and the app could not sell", () => {
    const o = opts("Soup");
    expect(o["Medium Goat"].p).toBe(5);
    expect(o["Large Goat"].p).toBe(10);
    expect(o["Medium Goat"].oos).toBeUndefined();
    expect(o["Large Goat"].oos).toBeUndefined();
  });

  it("sells only the salmon flavours the menu lists", () => {
    const o = opts("Salmon");
    expect(o["Steamed"].oos).toBe(true);
    expect(o["Jerk"].oos).toBe(true);
    for (const n of ["Sweet Chili", "Grilled", "Honey Garlic"]) {
      expect(o[n].oos).toBeUndefined();
    }
  });

  it("sells only the shrimp flavours the menu lists", () => {
    const o = opts("Shrimp");
    expect(o["Fried"].oos).toBe(true);
    for (const n of ["Sweet Chili", "Grilled", "Pepper", "Garlic", "Curried"]) {
      expect(o[n].oos).toBeUndefined();
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
