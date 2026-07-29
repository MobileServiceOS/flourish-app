/* Operating hours and pickup slots.
   Open 11AM daily. Closes 10PM Sunday to Thursday, 11PM Friday and Saturday.

   The printed trifold says 9AM-10PM every day; these hours supersede it, so the
   menu is the stale one. Worth reprinting.

   Every function takes `now` rather than reading the clock itself, so the
   checkout can be tested at 9:58PM on a Friday without waiting until Friday.
   Slot times are real Date objects; the label is only ever for display. */

export const OPEN_HOUR = 11;

/* An ASAP order is quoted as a window, not a single number — the kitchen needs
   15 minutes on a quiet afternoon and 25 in the middle of a rush, and promising
   the optimistic end is how customers arrive to a wait.
   PREP_MINUTES stays the *earliest* it could be ready, because that is what
   decides the first bookable slot; nothing can be promised sooner. */
export const PREP_MINUTES = 15;
export const PREP_MAX_MINUTES = 25;
export const READY_WINDOW = "15–25 min";

export const SLOT_MINUTES = 15;   // granularity of the pickup picker

/** 10PM, except Friday and Saturday which run to 11PM. 0=Sun ... 6=Sat. */
export const closeHourFor = (dow) => (dow === 5 || dow === 6 ? 23 : 22);

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

/** The earliest an ASAP order could be ready. */
export const asapReadyAt = (now = new Date()) =>
  new Date(now.getTime() + PREP_MINUTES * 60_000);

/** The far end of the quoted window. */
export const asapReadyBy = (now = new Date()) =>
  new Date(now.getTime() + PREP_MAX_MINUTES * 60_000);

/** "12:15 – 12:25 PM" — the window as clock times. */
export const formatWindow = (now = new Date()) =>
  `${formatTime(asapReadyAt(now))} – ${formatTime(asapReadyBy(now))}`;

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
export const HOURS_LINE = "Open daily 11AM–10PM · 11PM Fri & Sat";
