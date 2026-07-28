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

