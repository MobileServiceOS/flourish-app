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

/* A chip label — Seafood Fridays reads "(Fri)" on the six days it isn't on. */
export const chipLabel = (cat) =>
  cat === SEAFOOD_CAT && !TODAY_IS_FRIDAY ? `${cat} (Fri)` : cat;
