/* Operating hours and pickup slots.
   Open 9AM to 10PM, every day. Straight off the printed menu:
   "SUNDAY - SATURDAY 9AM-10PM".

   Every function takes `now` rather than reading the clock itself, so the
   checkout can be tested at 9:58PM on a Friday without waiting until Friday.
   Slot times are real Date objects; the label is only ever for display. */

export const OPEN_HOUR = 9;
export const PREP_MINUTES = 15;   // what the kitchen needs for an ASAP order
export const SLOT_MINUTES = 15;   // granularity of the pickup picker

/** 10PM, every day. Kept as a function of the weekday so late weekend hours are
    a one-line change if they ever come back. 0=Sun ... 6=Sat. */
export const closeHourFor = (_dow) => 22;

const at = (d, hour, min = 0) => {
  const x = new Date(d);
  x.setHours(hour, min, 0, 0);
  return x;
};

export const openingOn = (d) => at(d, OPEN_HOUR);
export const closingOn = (d) => at(d, closeHourFor(d.getDay()));

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

/** When an ASAP order is ready. */
export const asapReadyAt = (now = new Date()) =>
  new Date(now.getTime() + PREP_MINUTES * 60_000);

/**
 * Bookable pickup times: every 15 minutes from the earliest the kitchen could
 * plausibly have it, up to and including closing time. Empty when closed.
 */
export function pickupSlots(now = new Date()) {
  if (!isOpen(now)) return [];
  const close = closingOn(now);
  const slots = [];
  let t = ceilToSlot(asapReadyAt(now));
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

/** "today at 9:00 AM" / "Monday at 9:00 AM" — for the closed state. */
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
export const HOURS_LINE = "Open daily 9AM–10PM";
