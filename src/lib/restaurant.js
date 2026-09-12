/* Who and where Flourish is, plus the derived menu shapes the UI needs.
   Pure data and pure functions — no React in here. */
import { MENU, POPULAR_IDS } from "../data/menu.data.js";

/* Item photos live in public/items/ and are referenced by an `img` field on the
   item in menu.data.js. No `img` means the emoji tile, which is a deliberate
   fallback rather than a broken image.

   There used to be a helper here that built a DoorDash CDN URL out of the
   Clover item id. Those are different id namespaces, so it 403'd on every
   item — 43 failed cross-origin requests per menu render, always landing on
   the emoji anyway. DoorDash was where the menu was read from, not somewhere
   to serve customer traffic from. */

export const DOW = new Date().getDay(); // 0=Sun ... 6=Sat
export const TODAY_IS_FRIDAY = DOW === 5;
export const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const daysLabel = (days) => days.map((d) => DOW_NAMES[d]).join(" & ") + " only";

export const SEAFOOD_CAT = "Seafood Fridays";
export const ADDRESS = "4035 Laconia Ave, Bronx, NY 10466";
export const PHONE_E164 = "+13478599413";
export const PHONE_HUMAN = "(347) 859-9413";
export const MAPS_URL =
  "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(ADDRESS);

/* The Popular section renders the *same* item objects as the real categories —
   POPULAR_IDS holds ids and we look them up, so there is one source of truth for
   price, sold-out state and modifiers. Never copy an item here. */
export const ALL_ITEMS = MENU.flatMap((c) => c.items);
export const POPULAR = {
  cat: "Popular",
  sub: "What we're known for",
  items: POPULAR_IDS.map((id) => ALL_ITEMS.find((it) => it.id === id)).filter(Boolean),
};

/* A menu row shows "$15 – $18" for anything with more than one price, which
   does not say what the two numbers are. On nine plates they are simply the
   medium and the large, and saying so is more useful than a range.

   Only applies when the priced group is exactly Medium and Large. Pork is
   Medium/Large Stew and Medium/Large Jerk, Soup is medium/large across two
   proteins, Pasta and Side are lists of different dishes — for those a range
   is the honest summary, so they keep it.

   Returns { med, lg } or null. Never invents a price: both numbers come
   straight from the Clover modifier group. */
export function sizePrices(item) {
  const group = item.groups?.find((g) => g.kind === "variant");
  if (!group) return null;
  const avail = group.mods.filter((m) => !m.oos);
  if (avail.length !== 2) return null;
  const [a, b] = avail;
  if (a.n.trim().toLowerCase() !== "medium") return null;
  if (b.n.trim().toLowerCase() !== "large") return null;
  return { med: a.p, lg: b.p };
}

/* ============================================================================
   COMPARISONS A CUSTOMER CAN CHECK

   Both of these used to be one number in a teal pill reading "SAVE $4.00",
   sitting under "Med $20.00 · Lg $25.00". Read as a discount off our own price
   — the customer expects to pay $16 — and on five of eight items it was
   computed against the cheaper size while the card showed two, so on two of
   them the claim was false at the larger one.

   So: name what is being compared, show the other price, and return NOTHING
   rather than a number that cannot be defended.
   ============================================================================ */

/**
 * What Uber Eats charges for the same dish, or null when it cannot be said.
 *
 * Null in three cases, all deliberate: no Uber price on record; a single Uber
 * number against a dish sold in two sizes, which cannot say which size it is;
 * and a dish where we are not actually cheaper — an honest comparison includes
 * finding out we lost.
 */
export function uberComparison(item, ue) {
  const price = ue?.[item.id];
  if (price === undefined || price === null) return null;

  // Per size: one line per size, each against the price beside it.
  if (typeof price === "object") {
    const s = sizePrices(item);
    if (!s) return null;
    const rows = [
      { label: "Med", ours: s.med, theirs: price.med },
      { label: "Lg", ours: s.lg, theirs: price.lg },
    ].filter((r) => Number.isFinite(r.theirs) && r.theirs > r.ours)
     .map((r) => ({ ...r, saving: Math.round((r.theirs - r.ours) * 100) / 100 }));
    return rows.length ? { perSize: rows } : null;
  }

  /* A flat Uber price only means something against a flat price of ours.
     Against two sizes it is ambiguous, and guessing which size it refers to is
     how "SAVE $4.00" ended up on a plate whose Large costs a dollar more than
     Uber's. The generator reports every one of these on each run. */
  if (item.lo !== item.hi) return null;
  if (!(price > item.lo)) return null;
  return { theirs: price, ours: item.lo, saving: Math.round((price - item.lo) * 100) / 100 };
}

/**
 * What the Friday price saves against the everyday dish, or null.
 *
 * Null for the Friday items that are not cheaper — Friday shrimp is $1.99
 * DEARER than the everyday one, and Friday salmon is a cent under. Seafood
 * Fridays is a real promotion on two platters and simply a Friday-only dish on
 * the others, and a badge that flattened that difference would be the app
 * inventing a deal.
 */
export function fridaySaving(item, fridayVs) {
  const cmp = fridayVs?.[item.id];
  if (!cmp || !(cmp.everyday > item.lo)) return null;
  return {
    everyday: cmp.everyday,
    basis: cmp.basis,
    saving: Math.round((cmp.everyday - item.lo) * 100) / 100,
  };
}

/* A chip label — Seafood Fridays reads "(Fri)" on the six days it isn't on. */
export const chipLabel = (cat) =>
  cat === SEAFOOD_CAT && !TODAY_IS_FRIDAY ? `${cat} (Fri)` : cat;
