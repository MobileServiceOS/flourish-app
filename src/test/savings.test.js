import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MENU, UE, FRIDAY_VS } from "../data/menu.data.js";
import { uberComparison, fridaySaving, sizePrices } from "../lib/restaurant.js";

/* ============================================================================
   A COMPARISON A CUSTOMER CAN CHECK

   These numbers are the most checkable thing in the app: anyone can open Uber
   Eats and see whether we told the truth. So the bar is not "roughly right",
   it is "defensible or absent".

   What was there before: a teal pill reading "SAVE $4.00" beside
   "Med $20.00 · Lg $25.00", which reads as a discount off our own price — the
   customer expects to pay $16. It was computed against the CHEAPER size while
   the card showed two, so on five of eight items the claim did not describe the
   larger one, and on two it was outright false there:

     Oxtail         Lg $25.00 against Uber $24.00 — we are a DOLLAR dearer
     Fried Chicken  Lg $16.00 against Uber $15.60 — we are 40c dearer
   ============================================================================ */

const items = MENU.flatMap((c) => c.items);
const byId = (id) => items.find((i) => i.id === id);

describe("an Uber comparison is made or it is not made at all", () => {
  it("never claims a saving on an item sold in two sizes from one Uber price", () => {
    /* One number cannot say which of our sizes it is. This is the assertion
       that stops "SAVE $4.00" reappearing on a plate whose Large is dearer. */
    for (const [id, price] of Object.entries(UE)) {
      const item = byId(id);
      if (!item || typeof price !== "number") continue;
      if (item.lo === item.hi) continue;
      expect(uberComparison(item, UE), `${item.name}: one Uber price, two sizes`).toBeNull();
    }
  });

  it("never claims a saving where we are not actually cheaper", () => {
    for (const item of items) {
      const cmp = uberComparison(item, UE);
      if (!cmp) continue;
      if (cmp.perSize) {
        for (const r of cmp.perSize) expect(r.theirs, `${item.name} ${r.label}`).toBeGreaterThan(r.ours);
      } else {
        expect(cmp.theirs, item.name).toBeGreaterThan(cmp.ours);
        expect(cmp.saving).toBeCloseTo(cmp.theirs - cmp.ours, 10);
      }
    }
  });

  it("does compare the three one-price dishes, so the feature still exists", () => {
    /* Suppressing everything would also be "honest". It would also be useless,
       so this pins the ones that can be stated. */
    const shown = items.filter((i) => uberComparison(i, UE)).map((i) => i.name).sort();
    expect(shown).toEqual(["Lamb", "Salmon", "Shrimp"]);
  });

  it("carries their price, not just a saving, so the number anchors", () => {
    const lamb = uberComparison(byId("7916EWVQFPGH8"), UE);
    expect(lamb).toMatchObject({ theirs: 36, ours: 30, saving: 6 });
  });

  it("compares each size against the price beside it when given per-size data", () => {
    /* The mechanism the five suppressed items need. Exercised with a fixture
       rather than left untested until someone pastes real numbers in. */
    const oxtail = byId("60KCQ1V22Q98M");
    const s = sizePrices(oxtail);
    expect(s).toEqual({ med: 20, lg: 25 });

    const perSize = uberComparison(oxtail, { [oxtail.id]: { med: 24, lg: 28 } });
    expect(perSize.perSize).toEqual([
      { label: "Med", ours: 20, theirs: 24, saving: 4 },
      { label: "Lg", ours: 25, theirs: 28, saving: 3 },
    ]);
  });

  it("drops only the size where Uber is cheaper, keeping the other", () => {
    // Oxtail's real situation if their $24 turned out to be the Large.
    const oxtail = byId("60KCQ1V22Q98M");
    const cmp = uberComparison(oxtail, { [oxtail.id]: { med: 24, lg: 24 } });
    expect(cmp.perSize).toEqual([{ label: "Med", ours: 20, theirs: 24, saving: 4 }]);
  });

  it("says nothing at all for an item with no Uber price", () => {
    expect(uberComparison(byId("60KCQ1V22Q98M"), {})).toBeNull();
  });
});

/* ============================================================================
   SEAFOOD FRIDAYS IS A PROMOTION ON TWO DISHES, NOT ON THE SECTION

   Crab legs and lobster really are cheaper on Friday. The fish, salmon and
   shrimp platters are Friday-only DISHES at their own price — and the Friday
   shrimp is $1.99 ABOVE the everyday one. A customer who reads the section as a
   deal and then finds that trusts nothing else on the screen.
   ============================================================================ */

describe("the Friday saving is claimed only where there is one", () => {
  const CRAB = "BRMP82TR0Z45C";
  const LOBSTER = "A1YZ2ZD5CA1SW";
  const FRI_SHRIMP = "CAFAH5FKPTRW8";
  const FRI_SALMON = "0NQ5E11VABFDY";

  it("claims the two real ones, with the number it is measured against", () => {
    expect(fridaySaving(byId(CRAB), FRIDAY_VS)).toMatchObject({ everyday: 55, saving: 15.01 });
    expect(fridaySaving(byId(LOBSTER), FRIDAY_VS)).toMatchObject({ everyday: 50, saving: 10.01 });
  });

  it("states the basis, because $55 is not a price on any menu", () => {
    /* The everyday crab legs plate is $50 and the Friday one includes shrimp,
       so the like-for-like figure adds the $5 shrimp side. A bare "$55" with no
       explanation is the kind of number a customer cannot verify. */
    expect(fridaySaving(byId(CRAB), FRIDAY_VS).basis).toMatch(/\$50\.00 plus \$5\.00 for shrimp/);
  });

  it("claims NOTHING on the Friday shrimp, which is dearer than the everyday one", () => {
    expect(fridaySaving(byId(FRI_SHRIMP), FRIDAY_VS)).toBeNull();
  });

  it("claims nothing on the Friday salmon either, over a single cent", () => {
    expect(fridaySaving(byId(FRI_SALMON), FRIDAY_VS)).toBeNull();
  });

  it("refuses a comparison that is not a saving, however it got into the map", () => {
    // Belt and braces: the helper will not repeat the shrimp mistake.
    const shrimp = byId(FRI_SHRIMP);
    expect(fridaySaving(shrimp, { [shrimp.id]: { everyday: 20, basis: "Shrimp $20.00" } })).toBeNull();
  });

  it("says in the section copy which half is which", () => {
    const fri = MENU.find((c) => c.cat === "Seafood Fridays");
    expect(fri.sub).toMatch(/crab legs and lobster are cheaper today/i);
    expect(fri.sub).toMatch(/not discounts/i);
  });
});

/* ============================================================================
   THE APP MUST NEVER QUOTE BELOW THE REGISTER

   Clover prices its own orders, so an override that sets a price BELOW Clover's
   makes the app quote less than the till takes. It has happened three times —
   Whiting Fish X1 at $2.50 against a $3.00 register on 21 plates, Pasta Oxtail
   at $24 against $25, Chicken & Waffles at $15 against $15.99 — and it is the
   one direction a customer notices.

   Raising is the opposite and is the whole point of the printed-menu rule: the
   shop absorbs the difference until the dashboard catches up, and nobody is
   overcharged.
   ============================================================================ */

describe("no printed-menu override quotes under the till", () => {
  const gen = readFileSync(resolve(process.cwd(), "scripts/generate-menu.mjs"), "utf8");

  it("fails the generation rather than reporting it", () => {
    /* A line somebody scrolls past is not a control. The run exits non-zero. */
    expect(gen).toMatch(/override\(s\) would quote BELOW the register/);
    expect(gen).toMatch(/process\.exit\(1\)/);
  });

  it("checks BEFORE writing the file, so a bad menu never reaches a build", () => {
    /* This was wrong when first written: the guard sat after writeFileSync and
       told the reader "Nothing was written" while the file was already on disk.
       Order is the assertion. */
    const guard = gen.indexOf("would quote BELOW the register");
    const write = gen.indexOf("writeFileSync(OUT, js)");
    expect(guard).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(-1);
    expect(guard, "the guard must precede the write").toBeLessThan(write);
  });

  it("has no lowering override left in the maps", () => {
    /* The two that were: Pasta Oxtail ($24 over a $25 register) is deleted, and
       Chicken & Waffles ($15 over $15.99) is hidden, which retires its
       override without anyone having to pick a price. */
    expect(gen).not.toMatch(/"D0F1SFXHWSQWT::Oxtail"/);
    const hidden = gen.slice(gen.indexOf("const HIDDEN_ITEMS_IN_APP"));
    expect(hidden.slice(0, hidden.indexOf("};"))).toMatch(/1PBGJ1BWC3Z52/);
  });

  it("shows the register's price for pasta oxtail", () => {
    const pasta = items.find((i) => i.name === "Pasta");
    const oxtail = pasta.groups.flatMap((g) => g.mods).find((m) => m.n === "Oxtail");
    expect(oxtail.p).toBe(25);
  });

  it("keeps Chicken & Waffles off the menu entirely", () => {
    expect(items.some((i) => i.id === "1PBGJ1BWC3Z52")).toBe(false);
  });
});
