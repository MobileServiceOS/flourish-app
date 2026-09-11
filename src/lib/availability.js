/* What can be ordered today, and what cannot.

   Two kinds of day lock, one mechanism:

     ITEM      a whole dish is only cooked on certain days
               (Seafood Stew Peas, Fridays)
     MODIFIER  one option inside a group is only sold on certain days
               (soup comes in chicken Sunday to Thursday, seafood Friday and
               Saturday, and goat every day)

   Both are declared in scripts/generate-menu.mjs, baked into menu.data.js, and
   evaluated here. There is exactly one implementation so the register, the
   proxy and the sheet cannot disagree about whether today is Friday.

   ---------------------------------------------------------------------------
   THE DAY IS ALWAYS NEW YORK'S DAY.

   `new Date().getDay()` is the *device's* idea of the day. A customer in London
   at 1am Saturday is still in Friday evening as far as the kitchen is
   concerned, and a container running in UTC crosses midnight five hours early.
   Both would offer or refuse the wrong food, so the zone is named explicitly
   rather than inherited. This is the same reasoning as hours.js, which is why
   server/index.js pins TZ as well — belt and braces, since this no longer
   depends on it. */

import { MENU } from "../data/menu.data.js";

export const RESTAURANT_TZ = "America/New_York";
export const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const NY_WEEKDAY = new Intl.DateTimeFormat("en-US", {
  timeZone: RESTAURANT_TZ,
  weekday: "short",
});

/** 0=Sun … 6=Sat, in the restaurant's own timezone, for the instant given. */
export function dayOfWeek(now = new Date()) {
  const short = NY_WEEKDAY.format(now);
  const i = DOW_NAMES.indexOf(short);
  /* Intl is the only thing here that could surprise us across runtimes, so a
     failure to recognise its own output is loud rather than silently Sunday. */
  if (i < 0) throw new Error(`could not read a weekday for ${RESTAURANT_TZ}: got "${short}"`);
  return i;
}

/**
 * "Fri only", "Fri & Sat only", "Sun–Thu only".
 *
 * Three or more consecutive days read as a range; two read better joined. The
 * old label joined everything with " & ", which turned Sunday-to-Thursday into
 * "Sun & Mon & Tue & Wed & Thu only".
 */
export function daysLabel(days = []) {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (!sorted.length) return "never";

  const runs = [];
  for (const d of sorted) {
    const last = runs[runs.length - 1];
    if (last && d === last[last.length - 1] + 1) last.push(d);
    else runs.push([d]);
  }

  const parts = runs.map((run) => (run.length >= 3
    ? `${DOW_NAMES[run[0]]}–${DOW_NAMES[run[run.length - 1]]}`
    : run.map((d) => DOW_NAMES[d]).join(" & ")));

  return `${parts.join(" & ")} only`;
}

/* ---------------------------------------------------------------------------
   Lookups, built once from the generated menu. */

const ITEM_DAYS = new Map();
const MODIFIER_DAYS = new Map();   // `${gid}::${name}` -> days

for (const cat of MENU) {
  for (const item of cat.items) {
    if (item.days) ITEM_DAYS.set(item.id, item.days);
    for (const g of item.groups ?? []) {
      for (const m of g.mods ?? []) {
        if (m.days) MODIFIER_DAYS.set(`${g.gid}::${m.n}`, m.days);
      }
    }
  }
}

export const modifierKey = (gid, name) => `${gid}::${String(name ?? "").trim()}`;

/** The days this item is cooked, or null when it is cooked every day. */
export const itemDays = (itemId) => ITEM_DAYS.get(itemId) ?? null;

/** The days this modifier is sold, or null when it is sold every day. */
export const modifierDays = (gid, name) => MODIFIER_DAYS.get(modifierKey(gid, name)) ?? null;

const availableOn = (days, now) => !days || days.includes(dayOfWeek(now));

export const isItemAvailable = (itemId, now = new Date()) =>
  availableOn(itemDays(itemId), now);

export const isModifierAvailable = (gid, name, now = new Date()) =>
  availableOn(modifierDays(gid, name), now);

/**
 * Everything in this cart that cannot be ordered today, as a flat list.
 *
 * Returns `[]` for an orderable cart, so a caller reads it as a guard rather
 * than having to know the shape. Each entry carries enough to say WHY, because
 * "not available" with no reason sends a customer back to the menu to guess.
 */
export function unavailableInCart(cart = [], now = new Date()) {
  const out = [];
  for (const line of cart) {
    const days = itemDays(line.itemId);
    if (days && !days.includes(dayOfWeek(now))) {
      out.push({
        kind: "item",
        itemId: line.itemId,
        name: line.name ?? line.itemId,
        days,
        label: daysLabel(days),
      });
    }
    for (const mod of line.modifiers ?? []) {
      const mdays = modifierDays(mod.gid, mod.name);
      if (mdays && !mdays.includes(dayOfWeek(now))) {
        out.push({
          kind: "modifier",
          itemId: line.itemId,
          name: `${line.name ?? line.itemId} · ${mod.name}`,
          modifierName: mod.name,
          gid: mod.gid,
          days: mdays,
          label: daysLabel(mdays),
        });
      }
    }
  }
  return out;
}

/** One line a customer can read, for the whole refusal. */
export function unavailableMessage(entries = []) {
  if (!entries.length) return null;
  const one = entries[0];
  if (entries.length === 1) {
    return one.kind === "item"
      ? `${one.name} is available ${one.label.replace(/ only$/, "")} — not today.`
      : `${one.modifierName} is available ${one.label.replace(/ only$/, "")} — not today.`;
  }
  return `${entries.length} things in your order aren't available today: ` +
    `${entries.map((e) => e.modifierName ?? e.name).join(", ")}.`;
}
