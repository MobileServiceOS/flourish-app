/* Operating hours and pickup slots.
   Open 11AM, closed 10PM. Every day, no exceptions.

   The printed trifold says 9AM-10PM every day. The CLOSE now agrees; only the
   opening differs, and these hours supersede it — the trifold is still the
   stale one on that half. Worth reprinting.

   Every function takes `now` rather than reading the clock itself, so the
   checkout can be tested at 9:58PM on a Friday without waiting until Friday.
   Slot times are real Date objects; the label is only ever for display. */

export const OPEN_HOUR = 11;

/* There is no ASAP here any more, and no prep constant either. How long an
   order needs depends on what is in it — fish and seafood are cooked to order
   and cannot be promised in fifteen minutes — so prep time lives in lib/prep.js
   keyed by item, and every function below that needs it is HANDED it.

   A default parameter would quietly re-introduce the bug: a caller that forgot
   to pass a cart's prep time would get fifteen minutes and promise a salmon
   plate twice as fast as the kitchen can cook it. So these throw instead. */

export const SLOT_MINUTES = 15;   // granularity of the pickup picker

/* ONE CLOSING TIME, AND NO FUNCTION TO VARY IT.

   There used to be `closeHourFor(dow)` returning 23 on Friday and Saturday.
   That rule was wrong — the kitchen shuts at 10PM every day — and while it
   stood, the app took orders for an hour after the kitchen had gone home on the
   two busiest nights of the week.

   The day-varying function is deleted rather than made to return 22 for every
   day. A function whose only purpose was a special case, kept after the special
   case is gone, is somewhere for the rule to drift back to — and the whole
   shape of that failure (one rule in several places, one of them moved) is the
   same one that produced every price divergence in this project.

   If a late night ever comes back it should be re-added deliberately, with the
   copy and the ready-time guard updated in the same commit, not found lying
   here already half-built. */
export const CLOSE_HOUR = 22;

const at = (d, hour, min = 0) => {
  const x = new Date(d);
  x.setHours(hour, min, 0, 0);
  return x;
};

export const openingOn = (d) => at(d, OPEN_HOUR);
export const closingOn = (d) => at(d, CLOSE_HOUR);

export function isOpen(now = new Date()) {
  return now >= openingOn(now) && now < closingOn(now);
}

/** The next moment the door is unlocked. Today if it hasn't opened yet, else tomorrow. */
export function nextOpening(now = new Date()) {
  const todayOpen = openingOn(now);
  if (now < todayOpen) return todayOpen;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return openingOn(tomorrow);
}

/** Round up to the next SLOT_MINUTES boundary. */
function ceilToSlot(d) {
  const x = new Date(d);
  x.setSeconds(0, 0);
  const over = x.getMinutes() % SLOT_MINUTES;
  if (over) x.setMinutes(x.getMinutes() + (SLOT_MINUTES - over));
  return x;
}

/** The earliest this cart could be ready, given the prep time it needs. */
export function earliestReady(now, prepMinutes) {
  requirePrep(prepMinutes);
  return new Date(now.getTime() + prepMinutes * 60_000);
}

function requirePrep(prepMinutes) {
  if (!Number.isFinite(prepMinutes) || prepMinutes <= 0) {
    throw new Error("prepMinutes is required — it depends on what is in the cart");
  }
}

/**
 * Does the kitchen have time to cook this before the door shuts?
 *
 * This is the check that matters, and it is about the READY time, not the order
 * time. At 9:50PM the shop is open, but a 30-minute plate would come out of the
 * fryer twenty minutes after close — so the order has to be refused even though
 * `isOpen` says yes.
 */
export function readyFitsBeforeClose(readyBy, now = new Date()) {
  return readyBy <= closingOn(now);
}

/**
 * Bookable pickup times: every 15 minutes from the earliest the kitchen could
 * plausibly have this cart, up to and including closing time. Empty when closed,
 * and empty when nothing in the cart could be cooked before the door shuts.
 */
export function pickupSlots(now, prepMinutes) {
  requirePrep(prepMinutes);
  if (!isOpen(now)) return [];
  const close = closingOn(now);
  const slots = [];
  let t = ceilToSlot(earliestReady(now, prepMinutes));
  while (t <= close) {
    slots.push(new Date(t));
    t = new Date(t.getTime() + SLOT_MINUTES * 60_000);
  }
  return slots;
}

export const formatTime = (d) =>
  d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export const formatDay = (d) =>
  d.toLocaleDateString("en-US", { weekday: "long" });

/** "today at 11:00 AM" / "Monday at 11:00 AM" — for the closed state. */
export function describeOpening(open, now = new Date()) {
  const sameDay = open.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const when = sameDay
    ? "today"
    : open.toDateString() === tomorrow.toDateString()
      ? "tomorrow"
      : formatDay(open);
  return `${when} at ${formatTime(open)}`;
}

/** Human hours line for the footer. */
export const HOURS_LINE = "Open daily 11AM–10PM";
