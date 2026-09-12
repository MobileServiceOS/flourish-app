import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CURRENCY_ONE, CURRENCY_MANY, CURRENCY_RATE_LINE, SEPARATE_FROM_PERKS, currencyAmount,
} from "../lib/currency.js";
import { REWARDS, discountFor, pointsFor, IN_APP_POINTS_PER_DOLLAR } from "../lib/loyalty.js";
import { kitchenNote } from "../lib/cloverOrder.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/* ============================================================================
   TWO PROGRAMMES, TWO NAMES

   The shop runs Clover Perks at the register — text the code off the receipt,
   1 point per $1, 100 points = $5 off — and this app runs its own scheme. Both
   were called "points". A customer holding two balances under one word will
   reasonably try to spend one at the other, and nothing in either system can
   honour that: Perks balances are not readable through any API, not writable,
   and not exportable, so the app cannot even tell them what their other balance
   is.

   Naming is therefore the whole of the defence, which makes it worth testing
   mechanically rather than by re-reading the screens.
   ============================================================================ */

describe("the app's currency has its own name", () => {
  it("is not points, and not perks", () => {
    for (const s of [CURRENCY_ONE, CURRENCY_MANY]) {
      expect(s).not.toMatch(/point|pts|perk/i);
    }
    expect(CURRENCY_ONE).toBe("Petal");
    expect(CURRENCY_MANY).toBe("Petals");
  });

  it("counts correctly, because '1 Petals' reads as a bug", () => {
    expect(currencyAmount(1)).toBe("1 Petal");
    expect(currencyAmount(0)).toBe("0 Petals");
    expect(currencyAmount(24)).toBe("24 Petals");
  });
});

describe("the maths matches Perks, so neither balance is the worse one", () => {
  it("earns one per dollar", () => {
    expect(IN_APP_POINTS_PER_DOLLAR).toBe(1);
    expect(pointsFor(20)).toBe(20);
  });

  it("offers the same 100 = $5 that the receipt code does", () => {
    const five = REWARDS.find((r) => r.id === "r-5off");
    expect(five, "a plain $5-off reward").toBeTruthy();
    expect(five.cost).toBe(100);
    expect(five.cap).toBe(5);
  });

  it("actually takes $5 off, not the price of the line it matched", () => {
    /* `discountFor` takes the highest eligible line and caps it, so a $22 plate
       with an uncapped match would have given the whole plate away. */
    const cart = [{ price: 22, plate: true }, { price: 3.5 }];
    expect(discountFor({ rid: "r-5off" }, cart)).toBe(5);
  });

  it("says the rate the same way everywhere it is said", () => {
    expect(CURRENCY_RATE_LINE).toContain("1 Petal per $1");
    expect(CURRENCY_RATE_LINE).toContain("100 Petals = $5 off");
  });
});

describe("nothing implies the two balances combine", () => {
  it("says outright that they do not", () => {
    expect(SEPARATE_FROM_PERKS).toMatch(/perks/i);
    expect(SEPARATE_FROM_PERKS).toMatch(/don't combine|do not combine/i);
  });

  it("appears wherever a balance is shown, and before anyone joins", () => {
    for (const f of ["RewardsView.jsx", "SignInView.jsx"]) {
      const src = readFileSync(resolve(ROOT, "src/components", f), "utf8");
      expect(src, f).toMatch(/SEPARATE_FROM_PERKS/);
    }
  });

  it("never claims the app can read, move or convert a Perks balance", () => {
    const banned = /(your|check|view|see) (your )?perks (balance|points)|transfer|convert|combine (them|the two)|redeem (your )?perks/i;
    for (const f of componentSources()) {
      expect(read(f), f).not.toMatch(banned);
    }
  });
});

describe("the kitchen ticket names which scheme paid", () => {
  const FULL = {
    orderNumber: "FL-3412",
    customer: { name: "Kay K", phone: "3475551234" },
    pickupLabel: "2:10–2:20 PM",
  };

  it("says Petals reward, so staff are not left guessing between two schemes", () => {
    const note = kitchenNote({ ...FULL, reward: { name: "Free drink" } });
    expect(note).toContain("Petals reward: Free drink");
    /* A bare "Reward:" is the ambiguous form: staff cannot tell whether to
       debit a Perks balance that was never touched, or ask for a receipt code
       the customer never had. */
    expect(note).not.toMatch(/^Reward:/m);
  });
});

/* ---------------------------------------------------------------------------
   The sweep across the UI. Deliberately only over what a customer READS —
   `points`, `pointsAwarded`, `earnable` and `awardPoints` keep their names in
   the code, because `points` is a key inside every already-stored account and
   renaming it would read as absent on the next launch and zero every balance.
   --------------------------------------------------------------------------- */

function componentSources() {
  const dir = resolve(ROOT, "src/components");
  return readdirSync(dir).filter((f) => f.endsWith(".jsx")).map((f) => join(dir, f));
}
const read = (f) => readFileSync(f, "utf8");

/* Line by line, because a component is JSX and code on the same line and a
   regex spanning several lines matches the gap between them. Comments go
   first, then the identifiers that legitimately keep the old name, and
   anything still saying "points" on that line is text a customer can read. */
const CODE_NAMES = /\b(pointsAwarded|awardPoints|pointsFor|IN_APP_POINTS_PER_DOLLAR|onPointer\w+)\b|points-earned/g;

/* "the whole point of", "CLOVER_API_BASE points at api.clover.com" — the
   English word, not the currency. Listed rather than guessed at. */
const NOT_THE_CURRENCY = /\bpoints? (at|to|out)\b|\bthe (whole )?point\b|\bpoint of\b/i;

function pointsLines(src) {
  const out = [];
  let inBlockComment = false;
  src.split("\n").forEach((raw, i) => {
    let line = raw;
    if (inBlockComment) {
      if (!line.includes("*/")) return;
      line = line.slice(line.indexOf("*/") + 2);
      inBlockComment = false;
    }
    if (line.includes("/*")) {
      const rest = line.slice(line.indexOf("/*"));
      if (!rest.includes("*/")) inBlockComment = true;
      line = line.slice(0, line.indexOf("/*")) + (inBlockComment ? "" : rest.slice(rest.indexOf("*/") + 2));
    }
    line = line.replace(/\/\/.*$/, "");
    if (NOT_THE_CURRENCY.test(line)) return;
    line = line.replace(CODE_NAMES, " ");
    // `points` as a bare JS identifier: a prop, an argument, a state value.
    line = line.replace(/(^|[^\w"'`>])points(?=[\s,;:)}\].=]|$)/g, "$1 ");
    if (/\b(points?|pts)\b/i.test(line)) out.push(`${i + 1}: ${line.trim().slice(0, 80)}`);
  });
  return out;
}

describe("no screen says points to a customer", () => {
  it("has no visible 'points' or 'pts' left in any component", () => {
    const offenders = [];
    for (const f of componentSources()) {
      for (const hit of pointsLines(read(f))) offenders.push(`${f.split("/").pop()} ${hit}`);
    }
    expect(offenders).toEqual([]);
  });

  it("names the currency from one place, so it cannot drift between screens", () => {
    /* Every screen that shows the word imports it. A literal "Petals" typed
       into a component is how the cart and the ticket end up disagreeing after
       the next rename. */
    for (const f of componentSources()) {
      const src = read(f);
      const literal = /["'`][^"'`]*\bPetals?\b/.test(src.replace(/\/\*[\s\S]*?\*\//g, " "));
      if (literal) {
        expect(src, `${f.split("/").pop()} hardcodes the name`).toMatch(/from "\.\.\/lib\/(loyalty|currency)\.js"/);
      }
    }
  });
});
