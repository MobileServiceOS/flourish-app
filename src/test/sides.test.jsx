import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MENU, SIDE_ID } from "../data/menu.data.js";
import { buildAtomicOrder } from "../lib/cloverOrder.js";
import ItemSheet from "../components/ItemSheet.jsx";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

/* ============================================================================
   SIDES COST DIFFERENT AMOUNTS IN DIFFERENT PLACES

   Fried chicken is free with nothing and $6 on its own, and the shop means to
   charge for it with a plate too. Clover already models context-dependent
   pricing properly — "Side With Meal" and the standalone "Side" are separate
   modifier groups holding separate modifier objects, each with its own id and
   price — so nothing here forces one price per side.

   What went wrong is narrower: Clover has several meal-group sides at $0 by
   mistake, and once a price reaches the app, $0 is indistinguishable from
   "included". The sheet printed "Included" faithfully, for a side the shop
   charges for.
   ============================================================================ */

const MEAL_GROUP = "YQWN3PKBKV9NG";
const items = MENU.flatMap((c) => c.items);
const plate = items.find((i) => i.name === "Oxtail");
const standaloneSide = items.find((i) => i.id === SIDE_ID);
const mealSides = plate.groups.find((g) => g.gid === MEAL_GROUP).mods;

/* Read the intent out of the generator, so these tests check the data against
   the declaration rather than against a second copy of the same numbers. */
const gen = readFileSync(resolve(ROOT, "scripts/generate-menu.mjs"), "utf8");
const setBlock = (name, open, close) => {
  const a = gen.indexOf(`const ${name} = ${open}`);
  return gen.slice(a, gen.indexOf(close, a));
};
const UPCHARGE = Object.fromEntries(
  [...setBlock("SIDE_UPCHARGE", "{", "};").matchAll(/"([^"]+)":\s*([\d.]+)/g)]
    .map((m) => [m[1], Number(m[2])])
);
const FREE_WITH_MEAL = new Set(
  [...setBlock("SIDE_FREE_WITH_MEAL", "new Set([", "]);").matchAll(/"([^"]+)"/g)].map((m) => m[1])
);

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

/** Open the Oxtail sheet and read what each side row says on its right.
    Options render as `div.opt` with role="button", not as real buttons: the
    label is the second span inside the first span, the price the span after. */
function sideLabels() {
  render(<ItemSheet item={plate} onClose={() => {}} onAdd={() => {}} />);
  const sheet = screen.getByRole("dialog");
  const labels = {};
  for (const row of sheet.querySelectorAll(".opt")) {
    const name = row.children[0]?.children[1]?.textContent?.trim();
    if (!name) continue;
    // Side 1 and Side 2 render the same group, so a name is seen twice with
    // the same value. An absent price span means the row said nothing, which is
    // what an included side with `right` unset would look like.
    labels[name] = row.children[1]?.textContent?.trim() ?? "";
  }
  return { labels };
}

describe("the three side categories, on an entree sheet", () => {
  it("shows its price on every upcharge side", () => {
    const { labels } = sideLabels();
    for (const [name, price] of Object.entries(UPCHARGE)) {
      // Only the ones that exist in the meal group; Pepper Shrimp deliberately
      // is not one of them.
      if (!mealSides.some((m) => m.n === name)) continue;
      expect(labels[name], `${name} should carry an upcharge`).toBe(
        `+$${price.toFixed(2)}`
      );
    }
  });

  it("charges for fried chicken rather than calling it Included", () => {
    /* The reported bug, stated as itself. Clover has this at $0.00 in the meal
       group, so the sheet said "Included" — truthfully about the register, and
       wrongly about what the shop means to charge. */
    const { labels } = sideLabels();
    expect(labels["Fried Chicken"]).toBe("+$6.00");
    expect(labels["Fried Chicken"]).not.toBe("Included");
  });

  it("says Included for festival and pasta, which are free with a plate", () => {
    const { labels } = sideLabels();
    for (const name of FREE_WITH_MEAL) {
      expect(labels[name], `${name} is free with an entree`).toBe("Included");
    }
  });

  it("still sells festival and pasta at their own price on their own", () => {
    /* The whole point of the middle category: same dish, different price,
       because with a plate and on its own are different Clover modifiers. */
    for (const name of FREE_WITH_MEAL) {
      const alone = standaloneSide.groups[0].mods.find((m) => new RegExp(`^${name}`, "i").test(m.n));
      expect(alone, `${name} should be sellable on its own`).toBeTruthy();
      expect(alone.p, `${name} costs money on its own`).toBeGreaterThan(0);
    }
  });

  it("says Included for every remaining side, and charges nothing", () => {
    const { labels } = sideLabels();
    for (const m of mealSides) {
      if (UPCHARGE[m.n] !== undefined) continue;
      expect(labels[m.n], `${m.n} is included`).toBe("Included");
      expect(m.p, `${m.n} must be free with a plate`).toBe(0);
    }
  });
});

describe("what the customer was shown is what goes on the order", () => {
  const catalog = {
    [MEAL_GROUP]: Object.fromEntries(
      mealSides.map((m) => [m.n, { id: `MOD-${m.n}`, price: m.p }])
    ),
    [plate.groups.find((g) => g.kind === "variant").gid]: Object.fromEntries(
      plate.groups.find((g) => g.kind === "variant").mods.map((m) => [m.n, { id: `V-${m.n}`, price: m.p }])
    ),
  };

  const orderWithSides = (a, b) => {
    const variant = plate.groups.find((g) => g.kind === "variant");
    const pick = (g, name) => {
      const m = g.mods.find((x) => x.n === name);
      return { gid: g.gid, name: m.n, price: m.p };
    };
    return buildAtomicOrder({
      cart: [{
        name: plate.name, itemId: plate.id, qty: 1, price: 20,
        modifiers: [
          pick(variant, variant.mods.find((m) => !m.oos).n),
          pick({ gid: MEAL_GROUP, mods: mealSides }, a),
          pick({ gid: MEAL_GROUP, mods: mealSides }, b),
        ],
      }],
      customer: { name: "Kay K", phone: "3475550142" },
      pickupLabel: "2:10–2:20 PM",
      catalog,
    });
  };

  it("puts an upcharge side's price on the Clover line item", () => {
    const body = orderWithSides("Fried Chicken", "White Rice");
    const mods = body.orderCart.lineItems[0].modifications;
    const fried = mods.find((m) => m.name === "Fried Chicken");
    // 600 cents, matching the +$6.00 the sheet showed.
    expect(fried.amount).toBe(600);
  });

  it("puts zero on an included side, matching the Included it showed", () => {
    const body = orderWithSides("White Rice", "Candied Yams");
    for (const m of body.orderCart.lineItems[0].modifications) {
      if (m.name === "White Rice" || m.name === "Candied Yams") expect(m.amount).toBe(0);
    }
  });

  it("matches every meal-group side, shown price against line-item amount", () => {
    for (const side of mealSides) {
      if (side.oos) continue;
      const body = orderWithSides(side.n, "White Rice");
      const line = body.orderCart.lineItems[0].modifications.find((m) => m.name === side.n);
      expect(line.amount, `${side.n}: line item must carry the price shown`)
        .toBe(Math.round(side.p * 100));
    }
  });
});

describe("the declaration and the data cannot drift apart", () => {
  it("prices every upcharge side in the committed data as declared", () => {
    /* menu.data.js is generated, so the generator's set is the intent and this
       is the check that a regeneration carried it through. */
    for (const [name, price] of Object.entries(UPCHARGE)) {
      if (!mealSides.some((m) => m.n === name)) continue;
      expect(mealSides.find((m) => m.n === name).p, name).toBe(price);
    }
  });

  it("applies the upcharge on every plate, not just the one that was reported", () => {
    /* The meal group is shared across 19 plates. A fix that only reached Oxtail
       would be the same bug with a smaller blast radius. */
    const plates = items.filter((i) => i.groups.some((g) => g.gid === MEAL_GROUP));
    expect(plates.length).toBeGreaterThan(1);
    for (const p of plates) {
      const mods = p.groups.find((g) => g.gid === MEAL_GROUP).mods;
      for (const [name, price] of Object.entries(UPCHARGE)) {
        const hit = mods.find((m) => m.n === name);
        if (hit) expect(hit.p, `${p.name} / ${name}`).toBe(price);
      }
    }
  });

  it("keeps the two sets disjoint", () => {
    // A side cannot be both charged for and free with the same plate.
    for (const name of FREE_WITH_MEAL) expect(UPCHARGE[name]).toBeUndefined();
  });

  it("leaves Pepper Shrimp out, because it is not a meal-group side in Clover", () => {
    /* It exists only as a standalone side. Offering it with a plate would need a
       modifier added in Clover, which is not something the app can invent. */
    expect(UPCHARGE["Pepper Shrimp"]).toBeUndefined();
    expect(mealSides.some((m) => /pepper shrimp/i.test(m.n))).toBe(false);
    expect(standaloneSide.groups[0].mods.some((m) => /pepper shrimp/i.test(m.n))).toBe(true);
  });

  it("reports, rather than charges, a price on a side that should be included", () => {
    // The generator raises an issue instead of passing the charge on.
    expect(gen).toContain("is not an upcharge side");
    expect(gen).toMatch(/if \(m\.p !== 0\)/);
  });
});
