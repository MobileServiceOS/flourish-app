import { DRINK_ID, SIDE_ID } from "../data/menu.data.js";

/* ---------- LOYALTY ---------- */
export const TIERS = [
  { name: "Seedling", min: 0,   perk: "1 pt per $1 spent" },
  { name: "Bloom",    min: 250, perk: "Free side every 100 pts" },
  { name: "Flourish", min: 750, perk: "Priority pickup + birthday plate" },
];
export const REWARDS = [
  { id: "r-drink", cost: 60,  name: "Free drink",       desc: "Any drink on the menu.",   cap: 6,
    needs: "a drink",              match: (l) => l.itemId === DRINK_ID },
  { id: "r-side",  cost: 100, name: "Free side",        desc: "Any side up to $6.",       cap: 6,
    needs: "a side",               match: (l) => l.itemId === SIDE_ID },
  { id: "r-mac",   cost: 150, name: "Free seafood mac", desc: "Loaded seafood mac and cheese.", cap: 8,
    needs: "seafood mac & cheese",
    match: (l) => l.itemId === SIDE_ID && /seafood mac/i.test(l.meta || "") },
  { id: "r-plate", cost: 250, name: "Free plate",       desc: "Any regular plate up to $22.", cap: 22,
    needs: "a plate",              match: (l) => l.plate },
];
export const rewardOf = (v) => (v ? REWARDS.find((r) => r.id === v.rid) : null);

// Discount = the single highest-priced eligible line, capped at the reward's value.
export function discountFor(voucher, cart) {
  const r = rewardOf(voucher);
  if (!r) return 0;
  const elig = cart.filter(r.match);
  if (!elig.length) return 0;
  return Math.min(Math.max(...elig.map((l) => l.price)), r.cap);
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
