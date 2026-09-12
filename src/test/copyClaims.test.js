import { describe, it, expect } from "vitest";
import { MENU } from "../data/menu.data.js";
import { prepMinutesForItem, isNoPrepItem, COOKED_TO_ORDER_MINUTES } from "../lib/prep.js";
import { itemDays, daysLabel } from "../lib/availability.js";

/* ============================================================================
   COPY CANNOT CLAIM WHAT THE DATA CONTRADICTS

   Salmon's description read "Honey garlic, jerk, sweet chili, grilled, or
   steamed" while Steamed was hidden, so the row advertised a flavour the sheet
   would not offer. That was found by accident, which is the problem: menu copy
   lives in a hand-maintained map and the data it describes is generated from
   Clover, so they drift silently and in only one direction — the copy gets
   stale and keeps promising.

   These check every claim a name or a description can make against the data
   that would have to honour it. They are deliberately mechanical: a human
   re-reading 32 descriptions after every regeneration is not a control.
   ============================================================================ */

const items = MENU.flatMap((c) => c.items.map((i) => ({ ...i, cat: c.cat })));
const sideGroup = (i) => i.groups.find((g) => g.kind === "side");
const chooseable = (i) => i.groups.filter((g) => g.kind === "variant" || g.kind === "flavor");
const sellable = (i) => chooseable(i).flatMap((g) => g.mods.filter((m) => !m.oos));
const desc = (i) => (i.desc ?? "").toLowerCase();

/* A day name as a whole word: "fri", "friday", "fridays" — but not "fried". */
const DAY_WORD = /\b(mon|tues?|wed(nes)?|thur?s?|fri|sat(ur)?|sun)(day)?s?\b/i;

/* Known-broken, blocked at the register, and listed here so the check still
   fires for anything NEW.

   Both Friday platters are named "(Shrimp & 2 Sides)" and have no side group in
   Clover, so the promise is real and currently unkeepable. The owner is
   attaching `Side With Meal` (`YQWN3PKBKV9NG`) to both; until that lands and the
   menu is regenerated, the claim outruns the data.

   The allowlist cannot rot: the last test in this file fails once either item
   HAS the group, forcing the entry out rather than letting it sit here. */
/* EMPTY, because the register was fixed. Both platters now carry
   `Side With Meal`, so their names no longer promise sides the item cannot
   record — and the anti-rot assertion below is what forced these entries out
   rather than letting them sit here pretending the problem was still live. */
const PENDING_AT_REGISTER = new Set([]);

describe("every item has copy at all", () => {
  it("describes itself, or says nothing rather than something wrong", () => {
    // A missing description is fine — the row just shows a name and a price.
    for (const i of items) {
      if (i.desc !== undefined) expect(typeof i.desc, `${i.name}`).toBe("string");
      if (typeof i.desc === "string") expect(i.desc.trim(), `${i.name}`).toBeTruthy();
    }
  });
});

describe("a promise of sides must be keepable", () => {
  /* Five Friday platters were named "(Shrimp & 2 Sides)" with no side group at
     all, so ordering one told the kitchen nothing about what came with it. Two
     have the group attached now; three are hidden from the app. */
  it("never claims two sides in the NAME without a side group", () => {
    for (const i of items) {
      if (!/2 sides|two sides/i.test(i.name)) continue;
      if (PENDING_AT_REGISTER.has(i.id)) continue;
      expect(sideGroup(i), `${i.name} (${i.id}): the name promises sides the item cannot record`)
        .toBeTruthy();
    }
  });

  it("never claims sides in the DESCRIPTION without a side group", () => {
    for (const i of items) {
      if (!/two sides|2 sides|with sides/i.test(desc(i))) continue;
      if (PENDING_AT_REGISTER.has(i.id)) continue;
      expect(sideGroup(i), `${i.name} (${i.id}): "${i.desc}"`).toBeTruthy();
    }
  });

  it("never says 'no sides' while carrying a side group", () => {
    for (const i of items) {
      if (!/no sides/i.test(desc(i))) continue;
      expect(sideGroup(i), `${i.name}: "${i.desc}" but it has a side picker`).toBeFalsy();
    }
  });
});

describe("a promise about size must match the options", () => {
  it("never says 'one size' while offering a choice of sizes", () => {
    for (const i of items) {
      if (!/one size/i.test(desc(i))) continue;
      expect(sellable(i).length, `${i.name}: "${i.desc}"`).toBeLessThanOrEqual(1);
    }
  });

  it("never offers a size choice while the copy names a single one", () => {
    // "medium or large" is a claim about how many there are.
    for (const i of items) {
      if (!/\bmedium or large\b|\bmedium and large\b/i.test(desc(i))) continue;
      const n = sellable(i).length;
      expect(n, `${i.name}: "${i.desc}" but ${n} sellable options`).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("a flavour named in the copy must be sellable", () => {
  it("never advertises an option that is hidden", () => {
    /* The original bug: Salmon promised "steamed" while Steamed was oos. A
       customer reads the row, taps it, and the flavour is not there. */
    for (const i of items) {
      const d = desc(i);
      if (!d) continue;
      for (const g of i.groups) {
        if (g.kind === "side") continue;     // sides are not advertised by name
        for (const m of g.mods) {
          if (!m.oos) continue;
          // Compare the bare flavour word, without any "(...)" qualifier.
          const word = m.n.toLowerCase().replace(/\s*\(.*\)\s*$/, "").trim();
          if (word.length <= 3) continue;    // too short to match meaningfully
          expect(d.includes(word),
            `${i.name}: copy says "${word}" but that option is hidden`).toBe(false);
        }
      }
    }
  });
});

describe("a promise about when it is available must match the day lock", () => {
  it("names a day only when the item is actually locked to it", () => {
    for (const i of items) {
      const d = desc(i);
      /* Whole day words only. `\b(fri)\w*\b` matched "fried" in Shrimp's
         flavour list and reported a day claim that was not there. */
      if (!DAY_WORD.test(d)) continue;
      const days = itemDays(i.id);
      /* A day-named description on an item with no lock would be a promise
         nothing enforces — except in the Seafood Fridays category, whose own
         lock does the enforcing. */
      const enforced = days || i.cat === "Seafood Fridays";
      expect(enforced, `${i.name}: "${i.desc}" but nothing restricts the day`).toBeTruthy();
    }
  });

  it("names the right day when it names one", () => {
    for (const i of items) {
      const d = desc(i);
      const days = itemDays(i.id);
      if (!days || !DAY_WORD.test(d)) continue;
      // "Fridays only" against days [5] — the label's own words must appear.
      const label = daysLabel(days).toLowerCase();
      const named = label.split(/[^a-z]+/).filter((w) => w.length === 3);
      for (const w of named) {
        expect(d.includes(w), `${i.name}: "${i.desc}" against ${label}`).toBe(true);
      }
    }
  });
});

describe("a promise about timing must match the prep time", () => {
  it("never promises a quick plate for something cooked to order", () => {
    for (const i of items) {
      if (!/quick|fast|minutes|ready in/i.test(desc(i))) continue;
      expect(prepMinutesForItem(i.id), `${i.name}: "${i.desc}"`)
        .toBeLessThan(COOKED_TO_ORDER_MINUTES);
    }
  });

  it("says 'cooked to order' only where the prep time agrees", () => {
    for (const i of items) {
      /* "cooked to order" is the app's own term for the 30-minute class — the
         item sheet prints it on a chip. "Made to order" is ordinary marketing
         copy and says nothing about minutes, so it is not treated as a timing
         claim. Wings reads "Made to order. Pick your sauce." at 15 minutes,
         which is accurate: fried fresh, not a thirty-minute plate. */
      if (!/cooked to order/i.test(desc(i))) continue;
      expect(prepMinutesForItem(i.id), `${i.name}: "${i.desc}"`)
        .toBeGreaterThanOrEqual(COOKED_TO_ORDER_MINUTES);
    }
  });

  it("keeps no-prep items out of any timing claim", () => {
    // A side or a drink is handed over; "ready in" language would be odd.
    for (const i of items) {
      if (!isNoPrepItem(i.id)) continue;
      expect(/ready in|minutes/i.test(desc(i)), `${i.name}: "${i.desc}"`).toBe(false);
    }
  });
});

describe("the claims that are true today", () => {
  /* Guards against a future change quietly emptying these checks: if nothing
     matched any pattern, the suite above would pass while testing nothing. */
  it("is actually exercising the side and day checks", () => {
    const sideClaims = items.filter((i) => /two sides|2 sides/i.test(`${i.name} ${i.desc ?? ""}`));
    expect(sideClaims.length, "no item claims sides, so that check is vacuous")
      .toBeGreaterThan(0);
    for (const i of sideClaims) {
      if (PENDING_AT_REGISTER.has(i.id)) continue;
      expect(sideGroup(i), i.name).toBeTruthy();
    }

    const dayClaims = items.filter((i) => DAY_WORD.test(i.desc ?? ""));
    expect(dayClaims.length, "no item names a day, so that check is vacuous")
      .toBeGreaterThan(0);
  });
});

describe("the register-blocked allowlist cannot rot", () => {
  it("still names only items that genuinely lack the group", () => {
    /* The moment `Side With Meal` is attached in Clover and the menu is
       regenerated, these entries stop being exemptions and start being holes in
       the check. Failing here is the reminder to delete them. */
    for (const id of PENDING_AT_REGISTER) {
      const i = items.find((x) => x.id === id);
      if (!i) continue;      // hidden or delisted since — nothing to exempt
      expect(sideGroup(i),
        `${i.name} now HAS a side group: remove ${id} from PENDING_AT_REGISTER`)
        .toBeFalsy();
    }
  });

  it("stays small enough to be read", () => {
    // An allowlist nobody reads is just a disabled test.
    expect(PENDING_AT_REGISTER.size).toBeLessThanOrEqual(3);
  });
});
