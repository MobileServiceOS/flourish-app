import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  prepMinutesForItem, cartPrepMinutes, readyWindow, cartReadyWindow,
  roundToGrid, isCookedToOrder, isNoPrepItem, formatWindowLabel,
  DEFAULT_PREP_MINUTES, COOKED_TO_ORDER_MINUTES, UNKNOWN_PREP_MINUTES,
  WINDOW_SPAN_MINUTES,
} from "../lib/prep.js";
import { MENU } from "../data/menu.data.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const line = (itemId, qty = 1) => ({ itemId, qty, name: itemId });

/* Ids, not names — "Shrimp" is two different items in two categories, and a
   rename in Clover must not silently make a plate fast again. */
const SALMON = "H9520PFNBT2NY";
const SALMON_PLATTER = "0NQ5E11VABFDY";
const SHRIMP = "VHHCS7EDV70HC";
const SNAPPER = "VQZ0T4XK707EC";
const CRAB_LEGS = "598S0BJH4J7DE";
const LAMB = "7916EWVQFPGH8";
const JERK_CHICKEN = "SJGN0N254K8KE";
const OXTAIL = "60KCQ1V22Q98M";
const SIDE = "6NX7XK602V0ZM";
const DRINK = "D7MBX5PWRCGCE";

describe("per-item prep times", () => {
  it("gives fish and seafood thirty minutes — they are cooked to order", () => {
    for (const id of [SALMON, SALMON_PLATTER, SHRIMP, SNAPPER, CRAB_LEGS, LAMB]) {
      expect(prepMinutesForItem(id)).toBe(30);
    }
  });

  it("leaves the steam-table plates at fifteen", () => {
    for (const id of [JERK_CHICKEN, OXTAIL]) {
      expect(prepMinutesForItem(id)).toBe(15);
    }
  });

  it("assumes thirty for an item it has never heard of — never fifteen", () => {
    /* An unknown id is either new in Clover or something has gone wrong. In
       both cases promising fifteen minutes is a guess we cannot keep. */
    expect(prepMinutesForItem("NOT-A-REAL-ITEM")).toBe(30);
    expect(prepMinutesForItem(undefined)).toBe(UNKNOWN_PREP_MINUTES);
    expect(UNKNOWN_PREP_MINUTES).toBe(COOKED_TO_ORDER_MINUTES);
    expect(UNKNOWN_PREP_MINUTES).not.toBe(DEFAULT_PREP_MINUTES);
  });

  it("marks the thirty-minute plates for the item sheet", () => {
    expect(isCookedToOrder(SALMON)).toBe(true);
    expect(isCookedToOrder(JERK_CHICKEN)).toBe(false);
  });
});

describe("a cart's prep time is the slowest plate, not the sum", () => {
  it("takes the maximum — the kitchen cooks in parallel", () => {
    // Six jerk chickens are ready in fifteen minutes, not ninety.
    expect(cartPrepMinutes([line(JERK_CHICKEN, 6)])).toBe(15);
    expect(cartPrepMinutes([
      line(JERK_CHICKEN), line(OXTAIL), line(JERK_CHICKEN),
    ])).toBe(15);
  });

  it("is thirty for a mixed cart — the salmon decides it", () => {
    expect(cartPrepMinutes([line(JERK_CHICKEN), line(SALMON)])).toBe(30);
    expect(cartPrepMinutes([line(SALMON), line(JERK_CHICKEN)])).toBe(30);
  });

  it("is fifteen for chicken alone and thirty for seafood alone", () => {
    expect(cartPrepMinutes([line(JERK_CHICKEN)])).toBe(15);
    expect(cartPrepMinutes([line(SHRIMP)])).toBe(30);
  });

  it("does not let a side or a drink raise the window", () => {
    expect(isNoPrepItem(SIDE)).toBe(true);
    expect(isNoPrepItem(DRINK)).toBe(true);
    // A Coke alongside a jerk chicken is still a fifteen-minute order.
    expect(cartPrepMinutes([line(JERK_CHICKEN), line(DRINK), line(SIDE)])).toBe(15);
    // ...and cannot drag a seafood order down either.
    expect(cartPrepMinutes([line(SALMON), line(DRINK)])).toBe(30);
  });

  it("still quotes the default for a cart of nothing but drinks", () => {
    // A real order that still has to be bagged and handed over.
    expect(cartPrepMinutes([line(DRINK), line(SIDE)])).toBe(DEFAULT_PREP_MINUTES);
  });
});

describe("the promised window", () => {
  const at = (h, m) => new Date(2026, 6, 27, h, m, 0, 0);

  it("runs from now plus prep, for ten minutes", () => {
    const w = readyWindow(at(12, 0), 15);
    expect(w.start.getHours()).toBe(12);
    expect(w.start.getMinutes()).toBe(15);
    expect(w.end.getMinutes()).toBe(25);
    expect((w.end - w.start) / 60_000).toBe(WINDOW_SPAN_MINUTES);
  });

  it("rounds to the nearest five minutes", () => {
    // "Ready at 2:07" reads like precision the kitchen does not have.
    expect(roundToGrid(at(14, 7)).getMinutes()).toBe(5);
    expect(roundToGrid(at(14, 8)).getMinutes()).toBe(10);
    expect(roundToGrid(at(14, 12)).getMinutes()).toBe(10);
    expect(roundToGrid(at(14, 13)).getMinutes()).toBe(15);

    for (const m of [0, 3, 7, 11, 19, 28, 44, 58]) {
      const w = readyWindow(at(14, m), 30);
      expect(w.start.getMinutes() % 5).toBe(0);
      expect(w.end.getMinutes() % 5).toBe(0);
    }
  });

  it("pushes the window out for a cooked-to-order cart", () => {
    const noon = at(12, 0);
    expect(cartReadyWindow([line(JERK_CHICKEN)], noon).label).toBe("12:15–12:25 PM");
    expect(cartReadyWindow([line(SALMON)], noon).label).toBe("12:30–12:40 PM");
  });

  it("refuses to quote a window without a prep time", () => {
    // A default here would silently promise a salmon plate in fifteen minutes.
    expect(() => readyWindow(at(12, 0))).toThrow(/prep time/i);
    expect(() => readyWindow(at(12, 0), 0)).toThrow(/prep time/i);
  });

  it("drops the repeated meridiem but keeps both across noon", () => {
    expect(formatWindowLabel(at(14, 10), at(14, 20))).toBe("2:10–2:20 PM");
    expect(formatWindowLabel(at(11, 55), at(12, 5))).toBe("11:55 AM–12:05 PM");
  });

  it("never says ASAP", () => {
    for (const prep of [15, 30]) {
      for (const h of [11, 14, 21]) {
        expect(readyWindow(at(h, 0), prep).label).not.toMatch(/asap/i);
      }
    }
  });
});

/* ============================================================================
   Prep times live in scripts/generate-menu.mjs, keyed by Clover item id, so a
   regeneration from a fresh export carries them through. menu.data.js is
   generated and must never be hand-edited, so this test is what proves the two
   still agree — if someone adds a plate to the map and forgets to regenerate,
   or edits the data directly, this fails.
   ============================================================================ */
describe("prep times survive a menu regeneration", () => {
  const gen = readFileSync(resolve(HERE, "../../scripts/generate-menu.mjs"), "utf8");
  const between = (start, end) => {
    const a = gen.indexOf(start);
    return gen.slice(a, gen.indexOf(end, a));
  };

  const DEFAULT = Number(/const DEFAULT_PREP = (\d+)/.exec(gen)[1]);
  const COOKED = Number(/const COOKED_TO_ORDER = (\d+)/.exec(gen)[1]);
  const map = {};
  for (const m of between("const PREP_MINUTES = {", "};").matchAll(/"([A-Z0-9]+)":\s*(\w+)/g)) {
    map[m[1]] = m[2] === "COOKED_TO_ORDER" ? COOKED : m[2] === "DEFAULT_PREP" ? DEFAULT : Number(m[2]);
  }
  const noPrepIds = new Set(
    [...between("const NO_PREP_IDS = new Set([", "]);").matchAll(/"([A-Z0-9]+)"/g)].map((m) => m[1])
  );
  const noPrepCats = new Set(
    [...between("const NO_PREP_CATEGORIES = new Set([", "]);").matchAll(/"([^"]+)"/g)].map((m) => m[1])
  );

  const items = MENU.flatMap((c) => c.items.map((i) => ({ ...i, cat: c.cat })));

  it("keeps the generator's constants and the data's in step", () => {
    expect(DEFAULT).toBe(DEFAULT_PREP_MINUTES);
    expect(COOKED).toBe(COOKED_TO_ORDER_MINUTES);
  });

  it("gives every menu item a prep time", () => {
    for (const i of items) {
      expect(Number.isFinite(i.prepMinutes), `${i.name} (${i.id}) has no prepMinutes`).toBe(true);
      expect(i.prepMinutes).toBeGreaterThan(0);
    }
  });

  it("matches the generator's map item for item", () => {
    for (const i of items) {
      expect(i.prepMinutes, `${i.name} (${i.id})`).toBe(map[i.id] ?? DEFAULT);
    }
  });

  it("marks every side and drink as no-prep, and nothing else", () => {
    for (const i of items) {
      const expected = noPrepIds.has(i.id) || noPrepCats.has(i.cat);
      expect(Boolean(i.noPrep), `${i.name} (${i.id})`).toBe(expected);
    }
  });

  it("has no prep time set for an item that is no longer on the menu", () => {
    const ids = new Set(items.map((i) => i.id));
    for (const id of Object.keys(map)) {
      expect(ids.has(id), `${id} has a prep time but is not on the menu`).toBe(true);
    }
  });

  it("emits prepMinutes from the generator, not from a hand edit", () => {
    // The template that writes each item line has to carry the field, or the
    // next regeneration silently drops every prep time on the floor.
    expect(gen).toMatch(/prepMinutes: \$\{PREP_MINUTES\[i\.id\] \?\? DEFAULT_PREP\}/);
    expect(gen).toMatch(/\$\{prep\}\$\{search\}, groups:/);
  });
});
