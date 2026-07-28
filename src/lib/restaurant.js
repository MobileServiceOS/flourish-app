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

/* A chip label — Seafood Fridays reads "(Fri)" on the six days it isn't on. */
export const chipLabel = (cat) =>
  cat === SEAFOOD_CAT && !TODAY_IS_FRIDAY ? `${cat} (Fri)` : cat;
