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
    // Whiting Fish at $14 used to drag Snapper Fish's range down
    expect([item("Snapper Fish").lo, item("Snapper Fish").hi]).toEqual([20, 30]);
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

  it("never advertises a price for something hidden", () => {
    for (const it of all) {
      const g = it.groups.find((x) => x.kind === "variant");
      if (!g) continue;
      const hidden = g.mods.filter((m) => m.oos).map((m) => m.p);
      for (const p of hidden) {
        if (p < it.lo || p > it.hi) continue;   // inside the range is fine
        expect(p).not.toBe(it.lo);
        expect(p).not.toBe(it.hi);
      }
    }
  });
});
