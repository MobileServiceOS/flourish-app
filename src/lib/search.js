/* Searching the menu.

   Customers search for the dish, not for the row it happens to live in. "sweet
   chili salmon", "escovitch", "honey garlic" — every one of those is a
   MODIFIER, and matching only item names returned nothing for all of them.

   Each item carries a flattened `search` string built by the generator from its
   name plus every sellable modifier in its DISH-DEFINING groups — flavours,
   sizes, preparations. Two things are deliberately left out:

   - sold-out and off-menu modifiers, because surfacing a plate through a
     flavour we refuse to sell is worse than not matching: the customer taps the
     row and the thing they searched for is not on the sheet
   - the shared "Side With Meal" group, which is the same fourteen options on
     some twenty plates. Indexing it made any query containing a side word match
     nearly the whole menu. Sides are separately sellable, so the standalone Side
     item keeps its own options and "mac and cheese" still finds it there.

   Nothing here is hand-maintained. The index comes out of the Clover export, so
   renaming a flavour in Clover renames it in search on the next regeneration. */

/* Case and punctuation are noise: "Mac & Cheese", "mac and cheese" and
   "MAC AND CHEESE" are one search. `&` becomes a separator rather than the word
   "and", and bare joining words are dropped — otherwise a search for "mac and
   cheese" scores a name hit on every item with "and" in its name, which is most
   of them. Kept in step with normaliseSearch() in scripts/generate-menu.mjs;
   a test fails if the two ever disagree. */
const STOPWORDS = new Set(["and", "n", "with", "the", "a", "of"]);
export const normalise = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** A query as words. Word ORDER never matters — "fried shrimp" is "shrimp fried". */
export const queryTokens = (q) =>
  normalise(q).split(" ").filter((t) => t && !STOPWORDS.has(t));

/** The generated index: item name plus every sellable modifier. */
const indexOf = (item) => item?.search || normalise(item?.name);

/* The description is searched too, but it is not part of the generated index
   and it ranks below everything in it. Dropping it would lose real matches —
   "coconut" only appears in the Stew Peas description — while ranking it with
   the rest is what once buried the standalone Side item under seven plates
   whose descriptions read "with two sides". */
const oosWordsOf = (item) =>
  new Set(
    (item?.groups ?? [])
      .flatMap((g) => (g.mods ?? []).filter((m) => m.oos))
      .flatMap((m) => normalise(m.n).split(" "))
      .filter(Boolean)
  );

const haystack = (item) => {
  const index = indexOf(item);
  /* Descriptions go stale against the oos flags — Salmon's reads "Honey
     garlic, jerk, sweet chili, grilled, or steamed" while Steamed and Jerk are
     both off the menu. Matching that text would put the plate back in front of
     a customer searching for a flavour we refuse to sell, which is the exact
     thing leaving oos modifiers out of the index prevents. So a word that is
     only in the description BECAUSE it names an oos modifier is dropped. */
  const oos = oosWordsOf(item);
  const desc = normalise(item?.desc)
    .split(" ")
    .filter((w) => w && (!oos.has(w) || index.includes(w)))
    .join(" ");
  return `${index} ${desc}`.trim();
};

/**
 * Every token must appear somewhere. AND, not OR: "fried shrimp" means both
 * words, or the query would return everything fried plus everything with shrimp
 * in it and be no use at all.
 */
export function matchesQuery(item, q) {
  const tokens = queryTokens(q);
  if (!tokens.length) return true;
  const hay = haystack(item);
  return tokens.every((t) => hay.includes(t));
}

/* Where a match landed, best first. An exact item name has to beat a modifier
   mention, or searching "shrimp" leads with every plate that offers shrimp as a
   side rather than with the Shrimp plate itself. */
export const RANK = {
  EXACT_NAME: 0,
  NAME_PREFIX: 10,
  NAME_CONTAINS: 20,
  SPREAD: 30,        // the query is spread across the name and the modifiers
};

/** The modifier groups that define the dish, as opposed to what comes with it. */
const isDishGroup = (g) => g?.kind !== "side";

const dishWordsOf = (item) =>
  normalise(
    (item.groups ?? [])
      .filter(isDishGroup)
      .flatMap((g) => (g.mods ?? []).filter((m) => !m.oos).map((m) => m.n))
      .join(" ")
  );

/**
 * How well an item matches, LOWEST FIRST. A score, not a tier, because the
 * interesting cases are all ties otherwise: "fried shrimp" matches Shrimp,
 * Ackee & Shrimp and Shrimp & Waffles through the same two words, and the one
 * the customer meant is the one whose whole name is the word they typed.
 *
 * Beyond the exact-name tiers it adds up three penalties:
 *
 *   - query words the NAME could not account for, which is what separates
 *     "shrimp" the plate from a plate that merely mentions shrimp
 *   - matching only through the two included sides every plate shares. Those
 *     fourteen options are identical menu-wide, so they carry no information
 *     about which plate you wanted
 *   - words in the name the query did not ask for, so "Shrimp" beats
 *     "Shrimp & Waffles" for a query that never said waffles
 */
export function rankFor(item, q) {
  const query = normalise(q);
  if (!query) return RANK.SPREAD;

  const name = normalise(item.name);
  if (name === query) return RANK.EXACT_NAME;
  if (name.startsWith(query)) return RANK.NAME_PREFIX;
  if (name.includes(query)) return RANK.NAME_CONTAINS;

  const tokens = queryTokens(q);
  const nameWords = name.split(" ").filter(Boolean);

  const matchedByName = tokens.filter((t) => nameWords.some((w) => w.includes(t)));
  const unmatchedByName = tokens.length - matchedByName.length;

  const dishWords = dishWordsOf(item);

  /* Where the words the name could not account for turned up: the item's own
     flavour list, or — weaker, and last — its description. The shared sides are
     not in the index at all any more, so there is no third case. */
  const leftovers = tokens.filter((t) => !nameWords.some((w) => w.includes(t)));
  const viaDish = leftovers.some((t) => dishWords.includes(t));
  const descOnly = leftovers.length > 0 && !viaDish;

  const extraNameWords = nameWords.filter(
    (w) => !tokens.some((t) => w.includes(t))
  ).length;

  /* The name dominates. A word the name accounted for is far stronger evidence
     than the same word turning up in an options list, so an unmatched query
     word costs more than any other penalty — otherwise "fried shrimp" leads
     with an item that merely lists both words among its options. */
  return RANK.SPREAD
    + unmatchedByName * 6
    + (descOnly ? 4 : 0)
    + extraNameWords;
}

/**
 * Which modifier the customer was actually looking for.
 *
 * Searching "sweet chili salmon", landing on the Salmon sheet and finding it
 * defaulted to Grilled is worse than no match at all — the app found the dish
 * and then hid it. So the sheet opens on the flavour that was searched for.
 *
 * Only dish-defining groups are preselected. A side is what comes WITH the
 * plate, and quietly swapping someone's rice for something a search term
 * happened to touch is not a decision a search box gets to make.
 *
 * Returns { [gid]: index } for whatever it is confident about, {} otherwise.
 */
export function preselectFor(item, q) {
  const tokens = queryTokens(q);
  if (!tokens.length) return {};

  const out = {};
  for (const g of item.groups ?? []) {
    if (!isDishGroup(g)) continue;

    let best = -1;
    let bestScore = 0;
    (g.mods ?? []).forEach((m, i) => {
      if (m.oos) return;                       // never preselect what we won't sell
      const words = normalise(m.n);
      // How much of the query this option accounts for. A two-word hit on
      // "Sweet Chili" beats a one-word hit on "Chicken".
      const score = tokens.filter((t) => words.includes(t)).length;
      if (score > bestScore) { bestScore = score; best = i; }
    });

    if (best >= 0) out[g.gid] = best;
  }
  return out;
}

/**
 * Filter and rank one category's items. Returns a new array; ties keep the
 * menu's own order, because Array#sort is stable everywhere we ship.
 */
export function searchItems(items, q) {
  if (!normalise(q)) return items;
  return items
    .filter((it) => matchesQuery(it, q))
    .sort((a, b) => rankFor(a, q) - rankFor(b, q));
}
