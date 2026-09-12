/* The name of the app's own loyalty currency, and the strings that keep it
   honest alongside the shop's other programme.

   This module deliberately imports NOTHING. The kitchen-ticket builder needs
   the name too, and that file is shared with the server — importing it from
   loyalty.js would drag the entire generated menu into the order-building path
   for the sake of one word.

   TWO PROGRAMMES RUN AT ONCE, AND THEY MUST NOT LOOK LIKE ONE

   The shop runs Clover Perks at the register: text the code off the receipt,
   1 point per $1, 100 points = $5 off. Perks balances are not readable through
   any API — every loyalty path answers 405 — and are not exportable from the
   dashboard either. So this app cannot read a Perks balance, cannot write to
   one, and cannot migrate anybody across. Anything suggesting otherwise would
   be a promise no code here can keep.

   Which leaves naming as the whole of the defence. Both schemes were called
   "points", both earn 1 per $1, and a customer holding two balances under one
   word will reasonably expect to spend either at the other. They cannot.

   So the app's currency is PETALS.

     - it is not the word Perks uses, and not "points" either
     - it already belongs to the brand: the launch screen opens a ring of
       petals, and the tiers are Seedling / Bloom / Flourish. "Blooms" would
       have collided with a tier name; "Petals" does not
     - it counts naturally in the copy a customer reads — "you earned 24
       Petals" — which a word like "credit" does not

   The MATH is deliberately identical to Perks: 1 Petal per $1, 100 Petals =
   $5 off. Neither balance should feel like the worse one to be holding, so
   REWARD_FIVE_DOLLARS exists to make "100 = $5 off" literally true in the app
   rather than a slogan.

   `SEPARATE_FROM_PERKS` goes wherever a balance is shown. Every one of these
   strings is exported from here and nowhere else, so the name cannot drift
   between the cart, the ticket and the store listing — and a test asserts no
   customer-facing file says "points" on its own.

   NOTE ON THE INTERNAL NAMES. The stored account field is still `points`, and
   `pointsAwarded` / `earnable` / `awardPoints` keep their names. That is not an
   oversight: `points` is a key inside every customer's already-persisted
   account, and renaming it would read as absent on the next launch and zero
   every existing balance. The rename is of what a customer is shown.
   ============================================================================ */

/** What the app's own currency is called. Singular and plural. */
export const CURRENCY_ONE = "Petal";
export const CURRENCY_MANY = "Petals";

/** `n` of them, named — "1 Petal", "24 Petals". */
export const currencyAmount = (n) => `${n} ${Math.abs(Number(n)) === 1 ? CURRENCY_ONE : CURRENCY_MANY}`;

/** The headline rate, stated the same way everywhere it appears. */
export const CURRENCY_RATE_LINE = `1 ${CURRENCY_ONE} per $1 · 100 ${CURRENCY_MANY} = $5 off`;

/** Shown wherever a balance is, because two programmes run side by side. */
export const SEPARATE_FROM_PERKS =
  `${CURRENCY_MANY} are separate from the Perks you earn by texting the code on your ` +
  `receipt. The two balances don't combine, and neither can be spent on the other.`;

