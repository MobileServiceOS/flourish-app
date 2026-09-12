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
  { name: "Bloom",    min: 250, perk: `Free side every 120 ${CURRENCY_MANY}` },
  { name: "Flourish", min: 750, perk: "Priority pickup + birthday plate" },
];

/* One reward per order, and the app cannot police the other half of that.
   Perks balances are unreadable through any API, so if a customer uses a Perks
   $5 off at the counter on an order that already carries a Petals reward,
   nothing here can see it. Said outright wherever a reward is offered; staff
   enforce the Perks side at the register. */
export const ONE_REWARD_PER_ORDER =
  `One reward per order — ${CURRENCY_MANY} or Perks, not both. Staff apply Perks at the register.`;

/* ============================================================================
   THE LADDER, AND WHY THESE NUMBERS

   Four tiers land at exactly 5 cents per Petal, which is the Perks baseline —
   100 points for $5 off. Holding one balance should never feel like holding the
   worse one. The plate is deliberately richer at 6.3%, because $350 of spend is
   a long way to save and the top of a ladder has to be worth the climb.

   The old free drink at 60 Petals was 9.2% and made every other tier pointless
   to save for: a customer maximising value took drinks forever and never
   touched the rest. That is the mistake these numbers exist to correct, so do
   not move one without recomputing the rate.

     reward             cost   cap    cents per Petal
     Free drink          70   $3.50   5.0
     $5 off             100   $5.00   5.0
     Free side          120   $6.00   5.0
     Free seafood mac   160   $8.00   5.0
     Free plate         350  $22.00   6.3   <- deliberately richer

   TWO KINDS OF REWARD, because one rule cannot serve both.

   `kind: "item"` makes one qualifying item free, and the cap decides which
   items QUALIFY. A $10 Pasta side is not a "free side up to $6" — it is
   excluded, not discounted by six. Same for the $5.50 juices and the $6
   coconut water against the $3.50 drink: they are not what the reward is.

   `kind: "money"` is a flat amount off the order, capped at the reward's
   value. $5 off has to work this way — every plate on the menu costs more than
   $5, so an item-style cap would exclude the entire menu and the reward would
   never apply to anything.

   Getting this wrong in the safe-looking direction is what the old code did: it
   capped the DISCOUNT rather than the eligibility, so a $10 Pasta claimed as a
   free side quietly became $6 off and the customer paid $4 for a side the
   reward did not cover.
   ============================================================================ */
export const REWARDS = [
  { id: "r-drink", cost: 70,  kind: "item",  cap: 3.5,
    name: "Free drink",       desc: "Any soda, juice or water up to $3.50.",
    needs: "a drink under $3.50",
    match: (l) => l.itemId === DRINK_ID },

  { id: "r-5off",  cost: 100, kind: "money", cap: 5,
    name: "$5 off",           desc: "Five dollars off any order.",
    needs: "anything",
    match: () => true },

  { id: "r-side",  cost: 120, kind: "item",  cap: 6,
    name: "Free side",        desc: "Any side up to $6.",
    needs: "a side under $6",
    match: (l) => l.itemId === SIDE_ID },

  /* The $8 seafood mac is over the free-side cap on purpose — it has its own
     tier, and letting the cheaper reward cover it would make this one pointless. */
  { id: "r-mac",   cost: 160, kind: "item",  cap: 8,
    name: "Free seafood mac", desc: "Loaded seafood mac and cheese.",
    needs: "seafood mac & cheese",
    match: (l) => l.itemId === SIDE_ID && /seafood mac/i.test(l.meta || "") },

  { id: "r-plate", cost: 350, kind: "item",  cap: 22,
    name: "Free plate",       desc: "Any regular plate up to $22.",
    needs: "a plate under $22",
    match: (l) => l.plate },
];

/** Cents per Petal a reward returns. Used by a test to pin the ladder. */
export const rateOf = (r) => r.cap / r.cost;
export const rewardOf = (v) => (v ? REWARDS.find((r) => r.id === v.rid) : null);

/**
 * What a reward takes off this cart. 0 means it does not apply at all.
 *
 * "item" — the dearest qualifying line, free. The cap filters which lines
 *          qualify, so an over-cap item is excluded rather than part-paid.
 * "money" — a flat sum, capped at the reward's value and at the cart, so a
 *          $3 order cannot take $5 off and end up owing nothing.
 */
export function discountFor(voucher, cart) {
  const r = rewardOf(voucher);
  if (!r) return 0;
  const lines = Array.isArray(cart) ? cart : [];

  if (r.kind === "money") {
    const total = lines.reduce((n, l) => n + (Number(l.price) || 0), 0);
    return Math.min(r.cap, Math.max(0, total));
  }

  const elig = lines.filter((l) => r.match(l) && (Number(l.price) || 0) <= r.cap);
  if (!elig.length) return 0;
  return Math.max(...elig.map((l) => Number(l.price) || 0));
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
