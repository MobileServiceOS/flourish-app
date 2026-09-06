/* How long the kitchen needs, and the window that gets promised for it.

   Pure functions, no clock of their own — every entry point takes `now`, the
   same way hours.js does, so a 9:50PM Friday order can be tested on a Tuesday
   morning.

   The rule this file exists to enforce: **fish and seafood are cooked to order
   and cannot be promised in fifteen minutes.** Quoting the optimistic number is
   how a customer turns up to a wait, so an unknown prep time resolves to the
   slow one, never the fast one.

   The window is computed HERE and, in production, only ever on the server —
   see server/app.js POST /quote. The client displays what the server sent. Two
   independent computations of the same window is how the screen and the ticket
   come to disagree about when food is ready. */
import { MENU, DEFAULT_PREP_MINUTES, COOKED_TO_ORDER_MINUTES } from "../data/menu.data.js";

export { DEFAULT_PREP_MINUTES, COOKED_TO_ORDER_MINUTES };

/** An item we cannot find is assumed slow. Never 15, never "ASAP". */
export const UNKNOWN_PREP_MINUTES = COOKED_TO_ORDER_MINUTES;

/** How wide the promised window is, from its earliest edge. */
export const WINDOW_SPAN_MINUTES = 10;

/** Window edges are shown on a five-minute grid; "2:07" reads like precision we do not have. */
export const ROUND_TO_MINUTES = 5;

/* itemId -> { prepMinutes, noPrep }. Built from the generated menu, which is
   where prep times live so they survive a regeneration. */
const BY_ID = new Map();
for (const cat of MENU) {
  for (const item of cat.items) {
    BY_ID.set(item.id, {
      prepMinutes: Number(item.prepMinutes) || UNKNOWN_PREP_MINUTES,
      noPrep: Boolean(item.noPrep),
    });
  }
}

/** True for things handed over from the counter — a side on its own, a drink. */
export const isNoPrepItem = (itemId) => Boolean(BY_ID.get(itemId)?.noPrep);

/** True for the 30-minute plates, which the item sheet flags "cooked to order". */
export const isCookedToOrder = (itemId) =>
  prepMinutesForItem(itemId) >= COOKED_TO_ORDER_MINUTES;

/**
 * Prep time for one Clover item id.
 * An id we have never heard of gets the slow number: it is either new in Clover
 * and not yet in the menu, or something has gone wrong — and in both cases
 * promising fifteen minutes is a guess we cannot keep.
 */
export function prepMinutesForItem(itemId) {
  const hit = BY_ID.get(itemId);
  if (!hit) return UNKNOWN_PREP_MINUTES;
  return hit.prepMinutes;
}

/**
 * How long a whole cart needs: the MAXIMUM of its lines, never the sum. The
 * kitchen cooks in parallel; an order of six plates is ready when the slowest
 * one is, not six times later.
 *
 * Sides and drinks are excluded rather than counted as fast, so a Coke can
 * never be the line that decides the window. A cart of nothing but drinks still
 * quotes the default — it is a real order and still has to be bagged.
 */
export function cartPrepMinutes(cart = []) {
  let max = 0;
  for (const line of cart) {
    if (isNoPrepItem(line.itemId)) continue;
    max = Math.max(max, prepMinutesForItem(line.itemId));
  }
  return max || DEFAULT_PREP_MINUTES;
}

/** Nearest five minutes. Half-up, so 2:07:30 goes to 2:10. */
export function roundToGrid(date, minutes = ROUND_TO_MINUTES) {
  const ms = minutes * 60_000;
  return new Date(Math.round(date.getTime() / ms) * ms);
}

/**
 * The promised window: [now + prep, + WINDOW_SPAN_MINUTES], both edges on the
 * five-minute grid.
 *
 * Returns Date objects plus a label, because the label is what the customer
 * reads, what the kitchen ticket prints, and what the confirmation text says —
 * and all three have to be the same string.
 */
export function readyWindow(now, prepMinutes) {
  // No default. A caller that forgot to work out the cart's prep time would
  // otherwise silently get fifteen minutes, which is the exact bug this file
  // exists to remove.
  if (!Number.isFinite(prepMinutes) || prepMinutes <= 0) {
    throw new Error("readyWindow needs the cart's prep time");
  }
  const start = roundToGrid(new Date(now.getTime() + prepMinutes * 60_000));
  const end = new Date(start.getTime() + WINDOW_SPAN_MINUTES * 60_000);
  return { start, end, prepMinutes, label: formatWindowLabel(start, end) };
}

/** The window for a cart, in one call. */
export const cartReadyWindow = (cart = [], now = new Date()) =>
  readyWindow(now, cartPrepMinutes(cart));

const time = (d) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const meridiem = (d) => (d.getHours() < 12 ? "AM" : "PM");

/**
 * "2:10–2:20 PM", dropping the repeated meridiem — but keeping both when the
 * window straddles noon or midnight, where "11:55–12:05 PM" would be wrong.
 */
export function formatWindowLabel(start, end) {
  const a = time(start);
  const b = time(end);
  if (meridiem(start) === meridiem(end)) return `${a.replace(/\s?[AP]M$/, "")}–${b}`;
  return `${a}–${b}`;
}

/* What the menu says while someone is still browsing and there is no cart to
   quote. A range across the whole menu, deliberately not a promise about any
   one order — the real window comes from the server once there is a cart. */
export const PREP_RANGE_LABEL = `${DEFAULT_PREP_MINUTES}–${COOKED_TO_ORDER_MINUTES} min`;
