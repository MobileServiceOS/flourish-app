import { DRINK_ID, SIDE_ID } from "../data/menu.data.js";

/* The currency name and the Perks disclaimer live in their own module so the
   kitchen ticket can have them without importing the menu. Re-exported here
   because this is where callers reasonably look for them. */
export {
  CURRENCY_ONE, CURRENCY_MANY, CURRENCY_RATE_LINE, SEPARATE_FROM_PERKS, currencyAmount,
} from "./currency.js";
import { CURRENCY_ONE, CURRENCY_MANY } from "./currency.js";

/* ---------- LOYALTY ---------- */
export const TIERS = [
  { name: "Seedling", min: 0,   perk: `1 ${CURRENCY_ONE} per $1 spent` },
  /* Bloom used to promise "Free side every 120 Petals", which is not a tier
     perk at all — anyone with 120 Petals can take a free side regardless of
     tier. The countdown read "244 Petals to Bloom" and arriving unlocked
     nothing. Free lunch at 250 makes the number mean something. */
  { name: "Bloom",    min: 250, perk: "Free lunch unlocked" },
  /* Flourish promised "Priority pickup + birthday plate". Neither exists
     anywhere in the app, and copy must not outrun the data. What IS true at 750
     is that the dearest reward costs 350, so every reward is affordable. */
  { name: "Flourish", min: 750, perk: "Every reward within reach" },
];

/* One reward per order, and the app cannot police the other half of that.
   Perks balances are unreadable through any API, so if a customer uses a Perks
   $5 off at the counter on an order that already carries a Petals reward,
   nothing here can see it. Said outright wherever a reward is offered; staff
   enforce the Perks side at the register. */
export const ONE_REWARD_PER_ORDER =
  `One reward per order — ${CURRENCY_MANY} or Perks, not both. Staff apply Perks at the register.`;

/* ============================================================================
   A REWARD IS A DISCOUNT WITH A CEILING, NOT A GIFT WITH A GATE

   These used to refuse: the cap decided which items QUALIFIED, so a large
   oxtail at $25 against a "free plate" worth $22 was rejected outright. At the
   checkout, after the customer had chosen. That reads as broken software, and
   it is the wrong shape for an app that takes no money — there is nothing to
   settle, because the customer pays at the counter either way.

   So the cap is a ceiling on the DISCOUNT. Nothing is ever refused for being
   too expensive. A $25 large oxtail with the 350 reward sends a $20 discount
   and the customer pays the $5 difference plus tax at the register.

   That makes the wording load-bearing. "Free plate" on a $25 plate is a lie;
   "Free plate · $20 off any plate" is not, and `capLabel` below is what every
   screen prints so the ceiling cannot be stated in one place and omitted in
   another.

     reward             cost    cap      rate
     Free drink          70    $3.50     5.0%
     $5 off             100    $5.00     5.0%
     Free side          120    $6.00     5.0%
     Free seafood mac   160    $8.00     5.0%
     Free lunch         250   $12.50     5.0%   <- gives Bloom something to be
     Free plate         350   $20.00     5.7%   <- richer, as the top should be

   FREE PLATE IS $20, NOT $22. It was $22 (6.3%) and came down with the
   introduction of Free lunch, so the ladder rises smoothly instead of jumping.
   Do not "restore" $22: the two numbers were set together.
   ============================================================================ */
export const REWARDS = [
  { id: "r-drink", cost: 70,  kind: "item",  cap: 3.5,
    name: "Free drink",       desc: "Up to $3.50 off any drink.",
    needs: "a drink",
    match: (l) => l.itemId === DRINK_ID },

  { id: "r-5off",  cost: 100, kind: "money", cap: 5,
    name: "$5 off",           desc: "Five dollars off any order.",
    needs: "anything",
    match: () => true },

  { id: "r-side",  cost: 120, kind: "item",  cap: 6,
    name: "Free side",        desc: "Up to $6 off any side.",
    needs: "a side",
    match: (l) => l.itemId === SIDE_ID },

  { id: "r-mac",   cost: 160, kind: "item",  cap: 8,
    name: "Free seafood mac", desc: "$8 off seafood mac and cheese.",
    needs: "seafood mac & cheese",
    match: (l) => l.itemId === SIDE_ID && /seafood mac/i.test(l.meta || "") },

  { id: "r-lunch", cost: 250, kind: "item",  cap: 12.5,
    name: "Free lunch",       desc: "Up to $12.50 off any plate.",
    needs: "a plate",
    match: (l) => l.plate },

  { id: "r-plate", cost: 350, kind: "item",  cap: 20,
    name: "Free plate",       desc: "Up to $20 off any plate.",
    needs: "a plate",
    match: (l) => l.plate },
];

/** Cents per Petal a reward returns. Used by a test to pin the ladder. */
export const rateOf = (r) => r.cap / r.cost;

/**
 * How a reward's ceiling is stated, everywhere.
 *
 * Exported so the tier list and the redemption screen cannot describe the same
 * reward differently — "Free plate" alone invites a customer to expect a $50
 * crab platter for nothing.
 */
export const capLabel = (r) =>
  r.kind === "money" ? `$${r.cap.toFixed(2)} off any order`
    : `up to $${r.cap.toFixed(2)} off ${r.needs === "anything" ? "your order" : r.needs}`;

export const rewardOf = (v) => (v ? REWARDS.find((r) => r.id === v.rid) : null);

/**
 * What a reward takes off this cart. 0 means it does not apply at all.
 *
 * The cap is a CEILING, never a gate. A reward is refused only when the cart
 * holds nothing it applies to — no drink for a drink reward — and never for
 * being too expensive. The customer pays the difference at the counter, which
 * costs the app nothing because the app takes no money.
 *
 * "item"  — the dearest matching line, capped.
 * "money" — the cart total, capped, so a $3 order cannot take $5 off and end up
 *           owing nothing.
 */
export function discountFor(voucher, cart) {
  const r = rewardOf(voucher);
  if (!r) return 0;
  const lines = Array.isArray(cart) ? cart : [];
  const price = (l) => Number(l.price) || 0;

  const basis = r.kind === "money"
    ? lines.reduce((n, l) => n + price(l), 0)
    : Math.max(0, ...lines.filter((l) => r.match(l)).map(price));

  if (!(basis > 0)) return 0;
  return Math.min(basis, r.cap);
}

export const tierFor = (pts) => TIERS.reduce((t, x) => (pts >= x.min ? x : t), TIERS[0]);
export const nextTier = (pts) => TIERS.find((t) => pts < t.min) || null;


/* ============================================================================
   WHOSE RULES APPLY

   If the merchant runs Clover's own loyalty programme, its rules are the ones
   that count — two schemes disagreeing about a customer's balance is worse than
   either one alone. `GET /api/clover/loyalty` reports which we are on.

   Probed against this merchant: every loyalty path answers `405 GET not
   allowed`, which is what Clover says for a path it does not route at all — a
   made-up endpoint returns the identical response. So Flourish has no Clover
   programme today and the in-app scheme below is what runs.

   THE CLOVER BRANCH IS THEREFORE UNVERIFIED against a live programme. That is
   exactly why `cloverEarnRate` returns null rather than a guess when it does
   not recognise the payload: an earn rate invented from a field name that turned
   out to mean something else would quietly credit customers the wrong number,
   which is worse than carrying on with the scheme we know. Points are only ever
   computed from a rate we actually understood.
   ============================================================================ */

/** Our own rate: one point per dollar spent, after any discount. */
export const IN_APP_POINTS_PER_DOLLAR = 1;

/**
 * Points per dollar according to Clover, or null when we cannot tell.
 *
 * Null is a real answer and callers must handle it — it means "Clover has a
 * programme but we did not understand its rules", and the honest response is to
 * keep our own rate rather than invent one.
 */
export function cloverEarnRate(program) {
  if (!program || typeof program !== "object") return null;
  // The field names Clover has used for this. Anything else, and we say so.
  const candidates = [
    program.pointsPerDollar,
    program.rate,
    program.earnRate,
    program.accrual?.pointsPerDollar,
    program.accrual?.rate,
  ];
  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/**
 * What an order of `net` dollars earns, under whichever scheme is in force.
 * `loyalty` is the payload from GET /api/clover/loyalty, or null before it has
 * answered — in which case our own rate applies, which is also the fallback.
 */
export function pointsFor(net, loyalty = null) {
  const dollars = Math.max(0, Number(net) || 0);
  const rate = (loyalty?.configured && cloverEarnRate(loyalty.program))
    || IN_APP_POINTS_PER_DOLLAR;
  return Math.round(dollars * rate);
}
