import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CURRENCY_ONE, CURRENCY_MANY, CURRENCY_RATE_LINE, SEPARATE_FROM_PERKS, currencyAmount,
} from "../lib/currency.js";
import {
  REWARDS, TIERS, discountFor, pointsFor, IN_APP_POINTS_PER_DOLLAR, rateOf, capLabel, ONE_REWARD_PER_ORDER,
} from "../lib/loyalty.js";
import { DRINK_ID, SIDE_ID } from "../data/menu.data.js";
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

/* ============================================================================
   THE LADDER

   Four tiers at exactly 5 cents per Petal, which is the Perks baseline, so
   neither balance is the worse one to hold. The plate is richer on purpose.
   The old free drink at 60 Petals was 9.2% and made every other tier pointless
   to save for — a customer maximising value took drinks forever. These numbers
   exist to correct that, so they are pinned here rather than left to drift.
   ============================================================================ */

describe("the reward ladder holds its rate", () => {
  const by = (id) => REWARDS.find((r) => r.id === id);

  it("is the agreed six tiers at the agreed costs", () => {
    /* Free lunch at 250 was added to give Bloom something to be — the tier
       countdown read "244 Petals to Bloom" and arriving unlocked nothing. Free
       plate came down from $22 to $20 at the same time so the ladder rises
       smoothly rather than jumping. The two numbers were set together; do not
       restore $22 without revisiting 250. */
    expect(REWARDS.map((r) => [r.id, r.cost, r.cap])).toEqual([
      ["r-drink", 70, 3.5],
      ["r-5off", 100, 5],
      ["r-side", 120, 6],
      ["r-mac", 160, 8],
      ["r-lunch", 250, 12.5],
      ["r-plate", 350, 20],
    ]);
  });

  it("prices five of the six at exactly the Perks rate", () => {
    for (const id of ["r-drink", "r-5off", "r-side", "r-mac", "r-lunch"]) {
      expect(rateOf(by(id)), id).toBeCloseTo(0.05, 10);
    }
  });

  it("makes the plate richer, because $350 of spend has to be worth it", () => {
    const plate = rateOf(by("r-plate"));
    expect(plate).toBeGreaterThan(0.05);
    expect(plate).toBeCloseTo(0.057, 3);   // $20/350, down from $22
  });

  it("never lets a cheaper tier beat a dearer one on rate", () => {
    /* The failure the old ladder had: a 60-Petal drink returning 9.2% meant
       saving for anything else was irrational. */
    const rates = REWARDS.map(rateOf);
    expect(Math.max(...rates.slice(0, 5))).toBeCloseTo(0.05, 10);
  });
});

describe("a cap is a ceiling on the discount, never a refusal", () => {
  const by = (id) => REWARDS.find((r) => r.id === id);
  const DRINK = (price) => ({ itemId: DRINK_ID, price });
  const SIDE = (price, meta = "") => ({ itemId: SIDE_ID, price, meta });

  /* This block used to assert the opposite: that an over-cap item was EXCLUDED,
     so a $10 pasta side got nothing and a $25 oxtail was refused at the
     checkout after the customer had chosen it. That is the wrong shape for an
     app that takes no money — there is nothing to settle, because the customer
     pays at the counter either way, and a refusal reads as broken software.

     What must still hold is that the cap bounds the discount, and that the
     WORDING says so: "Free plate · up to $20 off any plate", never "Free
     plate" on its own. */

  it("gives a $2.50 soda away free, because it is under the cap", () => {
    expect(discountFor({ rid: "r-drink" }, [DRINK(2.5)])).toBe(2.5);
  });

  it("caps the $5.50 juice and the $6 coconut water rather than refusing them", () => {
    expect(discountFor({ rid: "r-drink" }, [DRINK(5.5)])).toBe(3.5);
    expect(discountFor({ rid: "r-drink" }, [DRINK(6)])).toBe(3.5);
  });

  it("caps a $10 Pasta side at $6 instead of excluding it", () => {
    expect(discountFor({ rid: "r-side" }, [SIDE(10)])).toBe(6);
    expect(discountFor({ rid: "r-side" }, [SIDE(6)])).toBe(6);
    expect(discountFor({ rid: "r-side" }, [SIDE(3)])).toBe(3);
  });

  it("caps a $25 large oxtail at $20 with the free plate", () => {
    // The customer pays the $5 difference plus tax at the counter.
    expect(discountFor({ rid: "r-plate" }, [{ plate: true, price: 25 }])).toBe(20);
  });

  it("gives Free lunch $12.50 of the same plate", () => {
    expect(discountFor({ rid: "r-lunch" }, [{ plate: true, price: 25 }])).toBe(12.5);
    expect(discountFor({ rid: "r-lunch" }, [{ plate: true, price: 10 }])).toBe(10);
  });

  it("takes the dearest matching line when there are several", () => {
    expect(discountFor({ rid: "r-side" }, [SIDE(3), SIDE(10), SIDE(5)])).toBe(6);
  });

  it("still refuses when the cart holds nothing the reward applies to", () => {
    /* The one refusal left, and the right one: a free drink against a cart with
       no drink cannot be applied to anything. */
    expect(discountFor({ rid: "r-drink" }, [{ plate: true, price: 20 }])).toBe(0);
    expect(discountFor({ rid: "r-side" }, [])).toBe(0);
  });

  it("states the ceiling in the label, so nobody expects a $50 platter free", () => {
    expect(capLabel(by("r-plate"))).toBe("up to $20.00 off a plate");
    expect(capLabel(by("r-lunch"))).toBe("up to $12.50 off a plate");
    expect(capLabel(by("r-5off"))).toBe("$5.00 off any order");
    for (const r of REWARDS) expect(capLabel(r), r.id).toMatch(/\$\d/);
  });
});

describe("the money reward is a flat sum, not an item", () => {
  it("takes $5 off an order of any size", () => {
    /* It has to work this way: every plate on the menu costs more than $5, so
       an item-style cap would exclude the whole menu. */
    expect(discountFor({ rid: "r-5off" }, [{ plate: true, price: 25 }])).toBe(5);
    expect(discountFor({ rid: "r-5off" }, [{ price: 20 }, { price: 6 }])).toBe(5);
  });

  it("never exceeds the cart, so a $3 order cannot end up owing nothing", () => {
    expect(discountFor({ rid: "r-5off" }, [{ price: 3 }])).toBe(3);
  });
});

describe("one reward per order, and the half the app cannot see", () => {
  it("says so wherever a reward is offered", () => {
    for (const f of ["RewardsView.jsx", "SignInView.jsx", "CartView.jsx"]) {
      expect(readFileSync(resolve(ROOT, "src/components", f), "utf8"), f)
        .toMatch(/ONE_REWARD_PER_ORDER/);
    }
  });

  it("names Perks and tells the customer staff hold that side", () => {
    expect(ONE_REWARD_PER_ORDER).toMatch(/one reward per order/i);
    expect(ONE_REWARD_PER_ORDER).toMatch(/perks/i);
    expect(ONE_REWARD_PER_ORDER).toMatch(/not both/i);
    expect(ONE_REWARD_PER_ORDER).toMatch(/register|staff/i);
  });
});
