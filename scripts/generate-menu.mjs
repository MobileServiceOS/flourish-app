#!/usr/bin/env node
/**
 * Rebuild src/data/menu.data.js from a Clover inventory export.
 *
 *   Clover Dashboard -> Items -> Export  (gives you an .xlsx)
 *   npm run menu -- ~/Downloads/inventory-export.xlsx
 *
 * Nothing about the menu should ever be edited by hand. Clover is the register;
 * whatever it says is what the customer gets charged. This script is the only
 * thing that writes menu.data.js.
 *
 * It also refuses to ship data that would charge a customer wrongly, and prints
 * a report of anything mispriced in Clover so it can be fixed at the source.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../src/data/menu.data.js");

const KEEP_CATEGORIES = new Set(["Lunch & Dinner", "Breakfast", "Seafood Fridays", "Drinks"]);
const SKIP_ITEMS = new Set(["Gift card", "Boil Food"]); // no price set in Clover

/* Items the kitchen has stopped making, keyed by Clover id. They often stay in
   the Clover inventory long after they come off the menu, so the export keeps
   handing them to us. Delisting here rather than by name because names repeat.
   Their DESC entries are left in place — harmless, and the copy comes back if
   the dish does. */
const DELISTED = new Set([
  "NH99VMKKGJ572",   // Baked Chicken — no longer offered
  // Not on the printed menu. Seafood Fridays, both drinks, Ackee & Shrimp and
  // Seafood Stew Peas are deliberately kept even though the trifold omits them.
  /* NEITHER CHICKEN PLATE WAS EVER MISPRICED, and both were delisted here on
     that false reading. Checked against the live register:

       Curry Chicken  49BD3KVSBHXRR  base $0 + group: Medium $13, Large $15
       BBQ Chicken    YQH6NFFB34SVM  base $0 + group: Medium $13, Large $16

     Base-$0-with-a-priced-size-group is the NORMAL shape here — Oxtail, Salmon,
     Wings and fifteen others are built identically — so "$0.00 in Clover, would
     ring free" was a price column read without the modifier-group column beside
     it. The same mistake, a third time, in a row of findings that also wrongly
     called twelve Breakfast items $0.00. A value read in isolation from the
     structure that gives it meaning.

     Curry Chicken is therefore un-delisted: it sells 15 times in its own right
     and there was never a reason to hide it. BBQ Chicken moves to
     HIDDEN_ITEMS_IN_APP, because the owner has taken it off the app menu — a
     decision, not a pricing fault, and the distinction is the whole point of
     keeping these maps separate. */
  "PEB98GZ1MBF6P",   // Lobster Tail (No Meal)
  "K7EX5APPAXPEJ",   // Lobster Roll & Fries
  "S0GK9MD2NE414",   // Salmon (1 Piece)
  "PZ1FB6X44MGYE",   // Lex Special
  /* Blue Crab is NOT duplicated. Confirmed by the owner against the register:
     DH0P3NGRN9RNE at $15 is the Friday price, in Seafood Fridays and carrying
     the Friday lock, and PSGB77QNZR2WM at $20 is the everyday one in
     Lunch & Dinner with no lock. Two prices for two different days, which is
     the one shape the app can express without day-dependent pricing.

     Both have now been wrong here in turn — first the $15 was delisted as a
     stray, then the $20 was. Neither was ever a duplicate, and both guesses
     came from reading two rows with one name as an error rather than asking.
     See docs/HIDE-REASONS-AUDIT.md. */
  "QDCGERYM91BP0",   // Beef Patty
  "Y79KKCYGMHRB6",   // Chicken Patty
]);
const SIDE_GROUP = "Side With Meal";
const SIDE_GROUP_GID = "YQWN3PKBKV9NG";

/* ============================================================================
   SIDES: THREE SETS, STATED OUTRIGHT

   A side costs a different amount depending on what it is attached to, and
   Clover already models that correctly — "Side With Meal" and the standalone
   "Side" are separate modifier GROUPS holding separate modifier OBJECTS with
   their own ids and their own prices. Festival is `T4SQAVXQ7MJ1E` at $0 with a
   plate and `SJ27CE6ZE34BW` at $1 on its own. So context-dependent pricing
   needs no special handling: it falls out of the data.

   What does need stating is which sides are meant to carry an upcharge with a
   plate, because Clover has several of them at $0 by mistake and $0 is
   indistinguishable from "included" once it reaches the app. Nothing was
   hardcoded before — the sheet simply printed "Included" for anything at $0,
   faithfully, including a fried chicken the shop means to charge for.

   1. UPCHARGE — priced with a plate.
   2. FREE_WITH_MEAL — $0 with a plate, but sold standalone at its own price.
      Declared rather than inferred so the category is testable; the data
      already behaves this way and this set asserts it stays that way.
   3. Everything else — included and free. Asserted to be $0, so a price
      appearing on one in Clover is reported instead of silently charged.
   ============================================================================ */

/* All four now match Clover, so none of these is an override any more — the
   map has become an assertion that the register keeps charging what the app
   shows. The generator reports any entry it has to apply.

   Fried Chicken and Whiting Fish X1 used to be $0 in the meal group, which the
   app worked around by quoting the standalone prices — the one divergence that
   ran in the shop's favour rather than the customer's. Both are priced at the
   register now.

   Whiting Fish X1 is $3.00, set deliberately at the register and verified
   against the live API. It was $2.50 here, which is the number this file had
   while the register still said $2.50 — and once the register moved to $3.00
   that stopped being an assertion and became an override pulling the app BELOW
   the till. Twenty-odd "lower ... 3 -> 2.50" lines in the generator output, on
   every plate sharing the group, quoting a customer 50c less than they would be
   charged. That is the complaint-generating direction and the exact divergence
   the register change had just closed.

   NOTE THE KEY IS NOT DELETED, and must not be. The third rule in this block is
   that any side NOT named here is asserted to be $0.00, so removing Whiting
   would make its legitimate $3.00 report as a pricing fault on every run. It
   stays, at the register's number, as an assertion rather than an override. */
const SIDE_UPCHARGE = {
  "Shrimp": 5.0,          // matches Clover
  "Seafood Mac": 3.5,     // matches Clover
  "Fried Chicken": 6.0,   // matches Clover since the register was corrected
  "Whiting Fish X1": 3.0, // matches Clover — raised at the register 2026-09-12
};

/* Free with a plate, priced on their own. No override: this set exists to be
   asserted, not applied.

   Pepper Shrimp is deliberately absent from all of this. It is a standalone
   side only ($15) and is not in the Side With Meal group at all, so it cannot
   be chosen with a plate. Adding it would be a Clover change, not a code one. */
const SIDE_FREE_WITH_MEAL = new Set(["Festival", "Pasta"]);

/* ============================================================================
   THE WRONG SIDE GROUP IS ATTACHED AT THE REGISTER

   Ten items were meant to get "Side With Meal" (YQWN3PKBKV9NG, 14 options, $0
   for the ones a plate includes). What they actually got is the STANDALONE
   "Side" group (S032100JQ3P4T, 21 options at standalone prices). Same word on
   the dashboard, different object, and the difference is money in both
   directions:

     - the app: a base price plus a priced group rings up double, so the
       generator zeroes the base. Crab Legs Platter (Shrimp & 2 Sides) came out
       as base $0 with a range of $1-$15 — a $39.99 platter advertised "from
       $1", priced off its corn bread.
     - the register: Clover adds modifiers to the base, so that platter now
       rings $39.99 + $5 white rice = $44.99, on a flyer that says two sides
       are included.
     - the options themselves: White Rice $5 and Mac & Cheese $6 where the
       plate includes them, plus Pepper Shrimp $15, Jerk Chicken $6 and
       Chicken Breast $5 offered as "sides" on a seafood platter.

   So the group is dropped here and the items keep the shape they had before —
   no side picker, correct base price — until the right group is attached. That
   is not the generator inventing data: it is refusing to quote a plate at a
   price neither the app nor the register believes.

   THE FIX IS AT THE REGISTER: on each item below, remove "Side" and add
   "Side With Meal". Then delete it from this map and regenerate. A test
   asserts every id here still has the wrong group, so the map cannot outlive
   the problem.
   ============================================================================ */
const STANDALONE_SIDE_GROUP = "Side";

/* EMPTY, AND THE PROBLEM IS FIXED. All ten items carry `Side With Meal` at the
   register now, and the standalone group is attached to nothing but the
   standalone Side item where it belongs. The generator reported each entry as
   no longer applicable, which is the anti-rot check doing its job — a map that
   outlived its problem would have stripped a side picker the register can ring.

   The mechanism is kept rather than deleted. Two different groups with the same
   word on the dashboard is a mistake that can be made again, and next time this
   is where it gets declared. */
const MISATTACHED_SIDE_GROUP = {};


/* ============================================================================
   UBER EATS PRICES — a comparison, and it has to be checkable

   Used for one thing: telling a customer what ordering direct saves them. Which
   means a customer can check it, on Uber, in ten seconds — so a number that is
   wrong or ambiguous costs more trust than the badge ever earned.

   TWO SHAPES ARE ACCEPTED:

     <id>: 24               a flat price. Only valid for a one-price dish.
     <id>: { med, lg }      per size, for a dish sold in two sizes.

   The flat form used to be applied to multi-size dishes and compared against
   the CHEAPEST size, which produced claims that were false at the other one:

     Oxtail         Med $20 · Lg $25   Uber $24.00   badge said SAVE $4.00
                    — but our Large is a dollar DEARER than Uber's
     Fried Chicken  Med $13 · Lg $16   Uber $15.60   badge said SAVE $2.60
                    — our Large is 40c dearer
     Curried Goat   Med $15 · Lg $18   Uber $18.00   badge said SAVE $3.00
     Wings          Med $15 · Lg $18   Uber $18.00   badge said SAVE $3.00
                    — both exactly level at the Large

   A single Uber number cannot say which of our sizes it corresponds to, so for
   a two-size dish it cannot support a claim at all. Those five now show
   NOTHING until someone supplies `{ med, lg }`, and the generator says so on
   every run. Showing nothing costs a badge; showing $4.00 off a plate that is
   a dollar dearer costs the customer's belief in every other number here.

   LAST CHECKED: never, by anyone. The original comment said "re-check these
   occasionally" and nobody has. docs/UBER-EATS-PRICES.md lists every claim for
   spot-checking. */
const UE = {
  /* One price, one Uber price: the comparison is unambiguous. */
  "7916EWVQFPGH8": 36,     // Lamb        — ours $30
  "H9520PFNBT2NY": 24,     // Salmon      — ours $22
  "VHHCS7EDV70HC": 24,     // Shrimp      — ours $20

  /* Two sizes, one Uber number: NOT ENOUGH to make a claim. Left here, and
     deliberately left flat, so the generator keeps reporting them until someone
     prices each size on Uber. Change to { med, lg } and the badge returns. */
  "60KCQ1V22Q98M": 24,     // Oxtail        Med $20 · Lg $25
  "NEAR47KAE44HC": 18,     // Curried Goat  Med $15 · Lg $18
  "C2RD25C1VXNN0": 18,     // Wings         Med $15 · Lg $18
  "SJGN0N254K8KE": 16.8,   // Jerk Chicken  Med $14 · Lg $16
  "QFNQ2XQB8SPN6": 15.6,   // Fried Chicken Med $13 · Lg $16
};

/* ============================================================================
   WHAT A FRIDAY PRICE IS ACTUALLY WORTH

   Seafood Fridays is a real promotion on two dishes and simply a different
   dish on the others, and the app should not imply otherwise. Numbers and
   reasoning: docs/FRIDAY-PRICING.md.

   The everyday figure is LIKE FOR LIKE, which is why it is declared rather than
   read off the everyday item: the Friday crab legs platter includes shrimp and
   two sides, so the honest comparison adds the $5.00 shrimp side to the $50.00
   everyday plate. Comparing $39.99 against a bare $50.00 would understate the
   saving; comparing it against nothing at all is what the app did before.

   An item absent from this map gets no comparison. That is the case for the
   two where Friday is not cheaper, and it is deliberate — see the note below. */
const FRIDAY_COMPARISON = {
  "BRMP82TR0Z45C": { everyday: 55.0, basis: "Crab Legs Platter $50.00 plus $5.00 for shrimp" },
  "A1YZ2ZD5CA1SW": { everyday: 50.0, basis: "Lobster $45.00 plus $5.00 for shrimp" },

  /* NOT HERE, ON PURPOSE:
       Shrimp  CAFAH5FKPTRW8  $21.99 Friday against $20.00 everyday — DEARER
       Salmon  0NQ5E11VABFDY  $21.99 Friday against $22.00 everyday — one cent
     Both Friday SKUs also carry no flavour group where the everyday dishes have
     four and six. A badge on either would be false or absurd, and a customer
     who checks and finds the shrimp $1.99 above the weekday price trusts
     nothing else on the screen. */
};

const EMOJI = {
  "Oxtail": "🍖", "Lamb": "🥩", "Wings": "🔥", "Lobster": "🦞", "Salmon": "🐟",
  "Shrimp": "🍤", "Snapper Fish": "🐠", "Pork": "🥓", "Pork Ribs": "🍖",
  "Curried Goat": "🍛", "Stew Peas": "🫘", "Soup": "🥣", "Pasta": "🍝",
  "Side": "🍚", "Drink": "🥤", "Blue Crab": "🦀", "Crab Legs Platter": "🦀",
  "Ackee & Shrimp": "🍤", "Chicken & Waffles": "🧇", "Shrimp & Waffles": "🧇",
  "Lunch Specials": "☀️", "Beef Patty": "🥟", "Chicken Patty": "🥟",
  "Lex Special": "⭐", "Pina Colada": "🍹", "Brown Stew Chicken": "🍛",
  "Fried chicken": "🍗", "BBQ Chicken": "🍗", "Baked Chicken": "🍗",
  "Jerk Chicken": "🍗", "Curry Chicken": "🍛", "Lobster Tail (No Meal)": "🦞",
  "Salmon (1 Piece)": "🐟", "Cornmeal Porridge": "🥣", "Banana Porridge": "🍌",
  "Hominy Corn Porridge": "🥣", "Peanut Porridge": "🥜", "Oats Porridge": "🥣",
  "Mix Up Porridge": "🥣", "Callao": "🌿", "Ackee N Saltfish": "🍳",
  "Cook Up Saltfish": "🐟", "Butterbean and Saltfish": "🫘",
  "Cabbage N Cornbeef": "🥬", "Ackee n Chicken Back": "🍳", "Fritter": "🥞",
  "Festival": "🥖", "Fry Dumpling": "🥟", "Seafood Stew Peas": "🫘",
  "Crab Legs Platter (Shrimp & 2 Sides)": "🦀", "Crab Legs & Shrimp": "🦀",
  "Fish Platter (Shrimp & 2 Sides)": "🐠", "Lobster Platter (Shrimp & 2 Sides)": "🦞",
  "Pepper Shrimp & Mussels": "🦐", "Lobster Roll & Fries": "🦞",
};

const CATEGORY_ORDER = ["Lunch & Dinner", "Seafood Fridays", "Breakfast", "Drinks"];
const CATEGORY_SUB = {
  "Lunch & Dinner": "Plates come with two sides",
  /* "Fridays only" was true and said nothing about price, under a heading that
     reads as a promotion. The Friday offer is NOT uniform: crab legs and
     lobster are genuinely cheaper today, the fish/salmon/shrimp platters are
     Friday-only dishes at their own price, and the Friday shrimp is $1.99 ABOVE
     the everyday one. A customer who reads "Seafood Fridays" as a deal and then
     finds the shrimp dearer trusts the app less than if it had framed nothing.
     So the subtitle says which half is which. */
  "Seafood Fridays":
    "Fridays only. Crab legs and lobster are cheaper today — the rest are "
    + "Friday-only dishes, not discounts.",
  "Breakfast": "Morning menu",
  "Drinks": "Refreshing beverages",
};

// Categories only sold on certain days. 0=Sun ... 6=Sat.
// The app greys the item out and says when it's back.
/* Which category an item belongs to when Clover files it in more than one.

   Without this the generator takes whichever the export lists first, which put
   Seafood Stew Peas, Blue Crab and Pepper Shrimp & Mussels under Lunch & Dinner
   — all three are on the Seafood Fridays flyer, and Lunch & Dinner is not day
   locked, so they read as everyday dishes. */
const ITEM_CATEGORY = {
  "32VDQ4G5J131P": "Seafood Fridays",   // Seafood Stew Peas
  "DH0P3NGRN9RNE": "Seafood Fridays",   // Blue Crab $15
  "PH221AJ7W66EA": "Seafood Fridays",   // Pepper Shrimp & Mussels

  /* Crab Legs & Shrimp is in BOTH Lunch & Dinner and Seafood Fridays at the
     register, and an item can only sit under one heading here. Without a pin
     the winner is `cats[0]` — whichever category the export happens to list
     first — and that decides whether the app treats it as Friday-only or
     everyday, because the Friday lock rides on the category. Availability must
     not depend on column order in a spreadsheet.

     Pinned to Lunch & Dinner deliberately: Clover has it in that category, so
     the register will ring it any day of the week. Pinning it to Seafood
     Fridays would make the app refuse Tuesday orders the counter would take
     happily — the app being stricter than the till is a lost sale, where the
     reverse is a refused order. Flip this one line if it really is Friday-only,
     and the Friday lock comes with it. */
  "21RNMJ880YCMC": "Lunch & Dinner",    // Crab Legs & Shrimp $39.99
};

const CATEGORY_DAYS = { "Seafood Fridays": [5] };

// Individual items only cooked on certain days, keyed by Clover id. Takes
// precedence over CATEGORY_DAYS. Clover has no concept of a day-limited item,
// so this map is the only place that knowledge lives.
const ITEM_DAYS = {
  "32VDQ4G5J131P": [5],      // Seafood Stew Peas — Fridays only
};

/* Modifiers only sold on certain days, keyed "<modifier group id>::<name>".

   Soup is one Clover item with six sizes in one group, and the kitchen makes
   the three soups on different days. Clover has no concept of a day-limited
   modifier any more than a day-limited item, so this map is the only place
   that knowledge lives — and it has to be a MODIFIER lock, because the thing
   with the window is an option inside a group, not a dish of its own.

   Hiding them instead (the `oos` route) would be wrong here: an option that is
   genuinely on the menu four days a week should say so, not vanish and leave a
   customer wondering whether the shop stopped making it. */
/* ============================================================================
   HIDDEN IN THE APP, STILL SOLD AT THE COUNTER

   A modifier the shop sells in person but does not want orderable through the
   app. Distinct from the other two reasons an option gets hidden, and kept
   separate so the reason survives:

     NOT_ON_PRINTED_MENU  on the register, not on the printed menu
     MISFILED_AS_SIZE     a separate dish sitting in another item's size group
     HIDDEN_IN_APP        deliberately app-only exclusion, this map

   The modifier stays in Clover untouched, so the register can still ring it.
   ============================================================================ */
/* ITEMS kept in Clover but not offered in the app. Parallel to HIDDEN_IN_APP
   below, which does the same for modifiers, and deliberately NOT `DELISTED` —
   that set means "the kitchen stopped making it", and blurring the two is how
   the Blue Crab entry ended up with a reason that was really a guess.

   Nothing here is deleted at the register. Staff can still ring all of it. */
const HIDDEN_ITEMS_IN_APP = {
  /* Off the app menu by the owner's decision. Priced correctly at the register
     (Medium $13, Large $16) and still sellable there — this is NOT the pricing
     reason it was delisted under, which was wrong. */
  "YQH6NFFB34SVM": "taken off the app menu by the owner; still rings at the register",

  /* THE THREE FRIDAY PLATTERS ARE DELIBERATELY NOT HERE.

     They were hidden on the reason "no sides group; <twin> is the same price and
     takes a flavour", and the first half of that expired the moment the register
     was fixed: all nine Seafood Fridays platters carry `Side With Meal`,
     confirmed in the live API and in the export. So the hide was neither an
     automatic check misfiring nor a stale export — it was this map, holding a
     reason that had stopped being true.

     The price halves still stand, and are handled where they belong rather than
     by hiding the dish: Friday shrimp is $1.99 DEARER than the everyday one and
     Friday salmon is a cent under, so neither appears in FRIDAY_COMPARISON and
     neither gets a saving claim. Listing a dish and declining to call it a
     bargain is honest; hiding it is not. */
};

/* Empty, and worth keeping rather than deleting: it is the declared home for
   "the register sells this, the app does not", and the next such decision
   should land here instead of being improvised.

   It held the two goat soup sizes until they were DELETED from the Soup group
   at the register. Hiding them in the app was always the smaller half of that
   fix — they rang $0 at the counter too — and with the modifiers gone there is
   nothing left to hide. The generator warns about any key here that names a
   modifier the export no longer carries, which is how these two were caught. */
const HIDDEN_IN_APP = {};

const MODIFIER_DAYS = {
  // Seafood soup — Friday and Saturday
  "H2749PVKFN4EY::Medium Seafood": [5, 6],
  "H2749PVKFN4EY::Large Seafood": [5, 6],
  // Chicken soup — Sunday through Thursday
  "H2749PVKFN4EY::Medium Chicken": [0, 1, 2, 3, 4],
  "H2749PVKFN4EY::Large Chicken": [0, 1, 2, 3, 4],
  /* Goat soup had no lock — it was made every day — and both its sizes have
     since been deleted from the group at the register. Soup is now chicken
     (Sun-Thu) and seafood (Fri-Sat), which still covers all seven days with
     two selectable sizes on each. The generator asserts that property. */
};

/* Modifiers that are really a separate dish sitting in another item's size
   group. The script already catches the case where the option is named after
   its own item (see the Wings issue in CLOVER-FIXES.md); these are the ones
   that need a human to spot them.
   Hidden from customers, and excluded from the item's price range, so the row
   does not advertise a starting price for something it cannot sell.
   Keyed by "<modifier group id>::<modifier name>". */
const MISFILED_AS_SIZE = {
  // Seafood stew peas is its own $30 dish, one size, Friday and Saturday only.
  // Sold from this group it would ring up any day of the week and read as a
  // third "size" of ordinary stew peas.
  "KR1HHY64E4QPJ::Seafood": "sold as its own item, Fridays only",
};

/* ============================================================================
   PRINTED MENU IS THE PRICE AUTHORITY

   The house charges what the printed menu says. Where Clover disagrees, these
   maps win and the app shows the menu price.

   !! THE REGISTER STILL RINGS THE CLOVER PRICE. !!
   Clover prices its own orders — this app deliberately sends no line prices —
   so until the Clover dashboard is updated to match, the counter and the app
   will disagree on these items. The script prints the exact list of changes to
   make in Clover every time it runs. See PRINTED-MENU-PRICES.md.
   ============================================================================ */

/* Modifier price from the printed menu. Keyed "<group id>::<modifier name>". */
const MENU_PRICE = {
  // Pork — Clover is $5-$8 under the menu on every plate
  "907Z8BF726CQ4::Medium Stew": 20,
  "907Z8BF726CQ4::Large Stew": 25,
  "907Z8BF726CQ4::Medium Jerk": 20,
  "907Z8BF726CQ4::Large Jerk": 25,
  // Pasta
  "D0F1SFXHWSQWT::Penne Alla Vodka": 18,
  "D0F1SFXHWSQWT::Oxtail": 24,
  // Sides
  "S032100JQ3P4T::Chicken Mac & Cheese": 7.0,
  // Lunch specials — the chicken plates are $8 on the menu
  "F0Q8615QD5HMM::Curried Chicken": 8.0,
  "F0Q8615QD5HMM::Fried Chicken": 8.0,
  "F0Q8615QD5HMM::Jerk Chicken": 8.0,
  "F0Q8615QD5HMM::Stew Chicken": 8.0,
};

/* Flat-priced items whose base disagrees with the menu. Keyed by Clover id. */
const ITEM_MENU_PRICE = {
  "1PBGJ1BWC3Z52": 15.0,   // Chicken & Waffles — Clover has $15.99
};

/* On the register but not on the printed menu, so not sold in the app.
   Keyed "<group id>::<modifier name>". */
const NOT_ON_PRINTED_MENU = new Set([
  "AJY3FTT4BRPHP::Whiting Fish",     // $14 full meal, not a listed dish — price claim verified live
  "AJY3FTT4BRPHP::Snapper Fish (Add On. No Sides)",   // menu lists fish at $30 only
  "ZR29AF0E4JPXA::Steamed",          // salmon flavour the menu does not list; 0 sales in 600 orders

  /* UN-HIDDEN after the sales audit — see docs/HIDE-REASONS-AUDIT.md.
     These four were excluded as "the printed menu does not list them", which may
     well be true, but the register says they are among the best sellers there
     are: Wings 185, Jerk salmon 25, Curry Goat 12, Oxtail 8 in 600 orders. A
     menu that omits the most-ordered lunch special is the stale document.

     The one reason that could still have justified hiding them was a time
     window — "Lunch Specials" sounds like one, and the app has day locks but no
     time-of-day locks. Checked: they sell 10:00 to 21:00, weighted to 11-13 but
     with real evening sales. It is a price tier, not a time window, so nothing
     is needed.

       NOT here: "F0Q8615QD5HMM::Wings"
       NOT here: "F0Q8615QD5HMM::Curry Goat"
       NOT here: "F0Q8615QD5HMM::Oxtail"
       NOT here: "ZR29AF0E4JPXA::Jerk" */
  /* NOT here: "4BY3GKC2SVJ90::Fried". The shop sells fried shrimp — it is a
     real flavour inside the Shrimp item's own group, and flagging it off-menu
     hid it from customers and from search. There is no separate Fried Shrimp
     item in Clover and there should not be one: Clover has a single Shrimp
     item with its flavours inside it. */
]);

/* Salmon is $22 in Clover and $22 on the menu — left exactly as it is.
   Its flavour list differs between the two (Clover: Sweet Chili, Grilled,
   Steamed, Honey Garlic, Jerk / menu: Pepper, Garlic, Curry in place of Steamed
   and Jerk) but that is a flavour question, not a price one, and nobody has
   said which list is right. Untouched on purpose. */

// One line of menu copy per item, keyed by Clover id — ids rather than names
// because "Blue Crab" is two different items at two different prices.
// Clover has no description field in the export, so this map is the source of
// truth. Adding an item to Clover without adding it here just means no
// description on the row; nothing breaks.
const DESC = {
  "598S0BJH4J7DE": "Crab legs and shrimp with two sides",
  "VGZYVZCB2NCRY": "Whole lobster with two sides",
  "PZ1FB6X44MGYE": "The house plate. Ask what's on it today.",
  "21RNMJ880YCMC": "Crab legs and shrimp, with two sides",
  "7916EWVQFPGH8": "Slow-braised lamb with two sides",
  "VQZ0T4XK707EC": "Brown stew, escovitch, or steamed",
  "ZTAQ37M4E9S4C": "Red peas simmered in coconut milk",
  "32VDQ4G5J131P": "Lobster tail, shrimp and conch. One size, large.",
  "60KCQ1V22Q98M": "Slow-cooked, fall-off-the-bone tender",
  "JAD3BJK9BSTW8": "Plain, chicken, shrimp, steak, or oxtail",
  "PEB98GZ1MBF6P": "Lobster tail on its own, no sides",
  /* "steamed" was in here while ZR29AF0E4JPXA::Steamed is hidden, so the copy
     promised a flavour the sheet would not offer. Jerk is back (25 sales), and
     steamed is out of the copy as well as out of the group. */
  "H9520PFNBT2NY": "Honey garlic, jerk, sweet chili, or grilled",
  "AYBW9QMTC6154": "Ackee and shrimp with two sides",
  "VHHCS7EDV70HC": "Sweet chili, garlic, curried, pepper, grilled, or fried",
  "8FW3GVMJKCGZG": "Stew or jerk, medium or large",
  "PSGB77QNZR2WM": "Blue crab with two sides",
  "JC6BRY4NX3A6E": "Fried dough, slightly sweet",
  "QB9EKT4QGVWDA": "Shrimp over waffles, six flavors to pick from",
  "K7EX5APPAXPEJ": "Lobster roll with a side of fries",
  "C2RD25C1VXNN0": "Made to order. Pick your sauce.",
  "NH99VMKKGJ572": "Baked in island seasoning, with two sides",
  "NEAR47KAE44HC": "Tender island-style curry goat",
  "433FBT50JEVY8": "Pork ribs with two sides",
  "PH221AJ7W66EA": "Pepper shrimp and mussels, plenty of heat",
  "QFNQ2XQB8SPN6": "Fried to order, medium or large",
  "YQH6NFFB34SVM": "BBQ chicken with two sides",
  "SJGN0N254K8KE": "Jerk chicken with two sides",
  "1PBGJ1BWC3Z52": "Fried chicken over waffles, six flavors",
  "VTKZ1S1K3GPK8": "Chicken braised down in brown stew gravy",
  "9WV3BMMSC8G5E": "Chicken, goat, or seafood",
  "6NX7XK602V0ZM": "One side on its own",
  "S0GK9MD2NE414": "One piece of salmon, no sides",
  "DH0P3NGRN9RNE": "Blue crab, Fridays only",
  "49BD3KVSBHXRR": "Curry chicken, medium or large",
  "KW21XBQ6XVTGA": "Smaller plates at lunch prices",
  "QDCGERYM91BP0": "Flaky crust, seasoned beef",
  "Y79KKCYGMHRB6": "Flaky crust, seasoned chicken",
  "BRMP82TR0Z45C": "Crab legs with shrimp and two sides",
  "A1YZ2ZD5CA1SW": "Lobster with shrimp and two sides",
  "06Z80836S0GZR": "Fish with shrimp and two sides",
  "CAFAH5FKPTRW8": "Shrimp with two sides",
  "0NQ5E11VABFDY": "Salmon with shrimp and two sides",
  "EWT1J5Q9K7KX0": "Mango, pina colada, or mixed",
  "D7MBX5PWRCGCE": "Sodas, juices, and coconut water",
};

/* ============================================================================
   SEARCH INDEX

   Customers search for the dish, not for the row it happens to live in.
   "fried shrimp", "sweet chili salmon", "escovitch" — every one of those is a
   MODIFIER, and matching only on item names returned nothing for all of them.

   So each item carries a flattened `search` string: its own name plus every
   modifier name across every group. Generated here, from the Clover export, so
   it cannot drift from the menu it describes — a hand-maintained keyword list
   would be wrong the first time anybody renamed a flavour in Clover.

   oos modifiers are LEFT OUT. Surfacing a plate through a flavour we refuse to
   sell is worse than not matching at all: the customer searches "steamed
   salmon", taps the row, and finds no steamed option on the sheet.

   The shared "Side With Meal" group is LEFT OUT TOO. It is the same fourteen
   options on some twenty plates, so indexing it made any query containing a
   side word match nearly the whole menu — "mac and cheese" returned twenty
   rows. Options that appear everywhere carry no information about which plate
   you wanted. Sides are separately sellable, so the standalone Side item keeps
   its own group (named "Side", kind "variant") and "mac and cheese" still finds
   it there.
   ============================================================================ */

/* Case and punctuation are noise: "Mac & Cheese" and "mac and cheese" are the
   same search — `&` is a separator, not the word "and". Kept in step with normalise() in src/lib/search.js, and a test
   fails if the emitted index ever drifts from what that file computes. */
const normaliseSearch = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function searchIndex(item) {
  const words = [];
  const seen = new Set();
  const add = (text) => {
    for (const w of normaliseSearch(text).split(" ")) {
      if (w && !seen.has(w)) { seen.add(w); words.push(w); }
    }
  };
  add(item.name);
  for (const g of item.groups) {
    // Dish-defining groups only: flavours, sizes, preparations.
    if (g.kind === "side") continue;
    for (const mod of g.mods) {
      if (mod.oos) continue;              // never surfaced through what we won't sell
      add(mod.n);
    }
  }
  return words.join(" ");
}

/* ============================================================================
   PREP TIME

   How long the kitchen needs before a plate can be promised, in minutes, keyed
   by Clover item id. Baked into menu.data.js as `prepMinutes` so the id — not
   the name — is what carries the knowledge through a regeneration. Clover has
   no prep-time field, so this map is the only place it lives.

   DEFAULT_PREP (15) covers everything held on the steam table. COOKED_TO_ORDER
   (30) is for anything that meets the fryer or the grill when the ticket lands:
   fish, salmon, shrimp, crab legs, lobster and lamb cannot be promised in 15
   minutes and quoting 15 is how a customer arrives to a twenty-minute wait.

   NO_PREP items — sides on their own, and drinks — are handed over from the
   counter and never raise a cart's window. They are excluded from the maximum
   rather than given a small number, so a Coke can never be the thing that
   decides when an order is ready.
   ============================================================================ */
const DEFAULT_PREP = 15;
const COOKED_TO_ORDER = 30;

const PREP_MINUTES = {
  "598S0BJH4J7DE": COOKED_TO_ORDER,   // Crab Legs Platter
  "VGZYVZCB2NCRY": COOKED_TO_ORDER,   // Lobster
  "7916EWVQFPGH8": COOKED_TO_ORDER,   // Lamb
  "VQZ0T4XK707EC": COOKED_TO_ORDER,   // Snapper Fish — brown stew, escovitch or steamed
  "32VDQ4G5J131P": COOKED_TO_ORDER,   // Seafood Stew Peas
  "H9520PFNBT2NY": COOKED_TO_ORDER,   // Salmon
  "AYBW9QMTC6154": COOKED_TO_ORDER,   // Ackee & Shrimp
  "VHHCS7EDV70HC": COOKED_TO_ORDER,   // Shrimp
  "DH0P3NGRN9RNE": COOKED_TO_ORDER,   // Blue Crab ($15, the Friday price)
  "PSGB77QNZR2WM": COOKED_TO_ORDER,   // Blue Crab ($20, everyday) — same dish, same pot
  "PH221AJ7W66EA": COOKED_TO_ORDER,   // Pepper Shrimp & Mussels
  "QB9EKT4QGVWDA": COOKED_TO_ORDER,   // Shrimp & Waffles
  "BRMP82TR0Z45C": COOKED_TO_ORDER,   // Crab Legs Platter (Shrimp & 2 Sides)
  "A1YZ2ZD5CA1SW": COOKED_TO_ORDER,   // Lobster Platter (Shrimp & 2 Sides)
  "06Z80836S0GZR": COOKED_TO_ORDER,   // Fish Platter (Shrimp & 2 Sides)
  "CAFAH5FKPTRW8": COOKED_TO_ORDER,   // Shrimp (Seafood Fridays)
  "0NQ5E11VABFDY": COOKED_TO_ORDER,   // Salmon (Shrimp & 2 Sides)

  /* Off the steam table like the other chicken plates, so fifteen — but stated
     explicitly rather than left to the default, because it is HIDDEN. A hidden
     item with no entry here comes back at 30 if it is ever un-hidden, and a
     test enforces that every hidden item keeps a time to return to. */
  "YQH6NFFB34SVM": DEFAULT_PREP,      // BBQ Chicken — hidden by the owner's decision
};

/* Handed over from the counter, so they never decide a cart's ready time. */
/* Handed over from the counter, so they never decide a cart's ready time.

   Listed by CLOVER ITEM ID, not by category. Live Clover has no "Drinks"
   category at all — both drink items are filed under Lunch & Dinner — so a
   category rule silently stopped applying and a Coke became a 15-minute item
   that pushed out the whole order's window. Ids do not depend on a register
   change. See docs/EXPORT-VS-CLOVER.md. */
const NO_PREP_IDS = new Set([
  "6NX7XK602V0ZM",   // Side, on its own
  "D7MBX5PWRCGCE",   // Drink
  "EWT1J5Q9K7KX0",   // Pina Colada
]);
/* Kept as a belt-and-braces layer: if a Drinks category is ever created in
   Clover, anything filed under it is no-prep without needing an id here. */
const NO_PREP_CATEGORIES = new Set(["Drinks"]);

// The six on the website's "What We're Known For", in that order.
const POPULAR_IDS = [
  "60KCQ1V22Q98M", // Oxtail
  "SJGN0N254K8KE", // Jerk Chicken
  "C2RD25C1VXNN0", // Wings
  "H9520PFNBT2NY", // Salmon — honey garlic
  "QFNQ2XQB8SPN6", // Fried Chicken
  "VHHCS7EDV70HC", // Shrimp — sweet chilli
];

const src = process.argv[2];
if (!src) {
  console.error("Usage: npm run menu -- <path-to-clover-export.xlsx>");
  process.exit(1);
}

/* Read the bytes ourselves rather than XLSX.readFile().
   The xlsx ESM build does not wire up Node's fs, so readFile() is simply not a
   function there — `npm run menu` died on this line with "XLSX.readFile is not
   a function" before anything was parsed. XLSX.read() on a Buffer needs no fs
   and behaves identically. */
const wb = XLSX.read(readFileSync(resolve(src)), { type: "buffer" });
const sheet = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: null });

/* ---------- modifier groups ---------- */
const groups = new Map();
let missingModifierIds = 0;
{
  let gid = null, gname = null;
  for (const r of sheet("Modifier Groups")) {
    gid = r["Modifier Group ID"] ?? gid;
    gname = r["Modifier Group Name"] ?? gname;
    if (!r["Modifier"]) continue;
    if (!groups.has(gname)) groups.set(gname, { gid, mods: [] });

    // Clover's export has changed this column's name between versions, so try
    // the ones seen in the wild. Without a modifier id the app cannot build a
    // Clover order line — see the note printed at the end of this script.
    const mid = r["Modifier ID"] ?? r["Modifier Id"] ?? r["Clover Modifier ID"] ?? null;
    if (!mid) missingModifierIds++;

    groups.get(gname).mods.push({
      n: String(r["Modifier"]).trim(),
      p: Number(r["Price"]) || 0,
      ...(mid ? { mid: String(mid).trim() } : {}),
    });
  }
}
const kindOf = (name) => {
  if (name === SIDE_GROUP) return "side";
  const mods = groups.get(name)?.mods ?? [];
  return mods.length && mods.every((m) => m.p === 0) ? "flavor" : "variant";
};

/* ---------- items (a Clover item spans several rows, one per group) ---------- */
const items = new Map();
{
  /* An item with several modifier groups spans several rows, and Clover blanks
     every column but "Modifier Groups" on the continuation rows. So these
     values have to carry forward — but ONLY within one item.

     They used to carry forward across item boundaries too, and that is a data
     corruption rather than an untidiness: an item whose OWN Categories cell is
     empty silently inherited the category of whichever item happened to sit
     above it in the sheet. This export has 15 uncategorised items (the
     breakfast dishes), and they arrived in the app filed under Lunch & Dinner —
     $0.00 porridges, fifteen-minute prep defaults and no descriptions — because
     the row above the first porridge was a Lunch & Dinner beef patty. Sheet
     order is not data. A new Clover ID therefore resets the carry, and an item
     with no category of its own now has none and is dropped by the filter
     below, which is what "leave Breakfast omitted" is supposed to mean.

     The same leak applied to Price: an item with a blank price would have
     inherited the previous item's, which is how a plate ends up charged as
     something else entirely. */
  let id = null, name = null, price = null, cat = null;
  for (const r of sheet("Items")) {
    if (r["Clover ID"]) {
      id = r["Clover ID"];
      name = r["Name"];
      price = r["Price"];
      cat = r["Categories"];
    } else {
      name = r["Name"] ?? name;
      price = r["Price"] ?? price;
      cat = r["Categories"] ?? cat;
    }
    if (!id) continue;
    if (!items.has(id)) {
      items.set(id, { id, name: String(name).trim(), base: Number(price) || 0, cats: new Set(), groups: [] });
    }
    const it = items.get(id);
    if (cat) it.cats.add(String(cat).trim());
    const g = r["Modifier Groups"];
    if (g && !it.groups.includes(String(g).trim())) it.groups.push(String(g).trim());
  }
}

/* ---------- build, correcting anything that would mischarge ---------- */
const issues = [];
const priceEdits = [];   // where the printed menu overrode Clover
const offMenu = [];      // sold on the register, not on the printed menu
const appHidden = [];    // sold at the counter, deliberately not in the app
const misattachedSides = []; // the standalone Side group attached instead of Side With Meal
const out = [];

for (const it of items.values()) {
  const cats = [...it.cats].filter((c) => KEEP_CATEGORIES.has(c));
  if (!cats.length || SKIP_ITEMS.has(it.name) || DELISTED.has(it.id) || it.name.includes("(Catering")) continue;
  if (HIDDEN_ITEMS_IN_APP[it.id]) {
    appHidden.push(`${it.name} ($${it.base}) — ${HIDDEN_ITEMS_IN_APP[it.id]}`);
    continue;
  }

  const gs = it.groups
    .filter((g) => groups.has(g))
    .map((g) => ({ gid: groups.get(g).gid, name: g, kind: kindOf(g), mods: groups.get(g).mods.map((m) => ({ ...m })) }));

  /* Drop the standalone side group where it was attached in place of
     "Side With Meal". Done before the base-price check below, so the plate
     keeps its real price instead of being zeroed as a double-ringing size
     group. See MISATTACHED_SIDE_GROUP. */
  if (MISATTACHED_SIDE_GROUP[it.id]) {
    const wrong = gs.findIndex((g) => g.name === STANDALONE_SIDE_GROUP);
    if (wrong === -1) {
      issues.push(
        `${it.name} (${it.id}): listed in MISATTACHED_SIDE_GROUP but "${STANDALONE_SIDE_GROUP}" ` +
        `is no longer attached — remove the entry from the generator and regenerate`
      );
    } else {
      gs.splice(wrong, 1);
      misattachedSides.push(`${it.name} (${it.id}) — "${STANDALONE_SIDE_GROUP}" attached instead of "${SIDE_GROUP}"`);
    }
  }

  let base = it.base;
  const variants = gs.filter((g) => g.kind === "variant");

  // A base price AND a priced size group means Clover adds them together.
  if (base > 0 && variants.length) {
    issues.push(`${it.name}: base $${base} plus a priced size group — rings up double at the register`);
    base = 0;
  }

  /* Sides with a plate, against the three sets above. Done before the general
     printed-menu pass so a side override is reported as a side, not as an
     anonymous modifier edit. */
  for (const g of gs) {
    if (g.kind !== "side") continue;
    for (const m of g.mods) {
      const want = SIDE_UPCHARGE[m.n];
      if (want !== undefined) {
        if (want !== m.p) {
          priceEdits.push({ item: it.name, group: g.name, option: m.n, clover: m.p, menu: want });
          m.p = want;
        }
        continue;
      }
      /* Not an upcharge, so it is included and must be free. A price here means
         Clover has started charging for something the menu gives away with the
         plate — reported rather than passed on to a customer. */
      if (m.p !== 0) {
        issues.push(
          `${it.name}: side "${m.n}" is $${m.p} in "${g.name}" but is not an upcharge side — ` +
          "either add it to SIDE_UPCHARGE or set it to $0 in Clover"
        );
      }
    }
  }

  // Printed-menu price wins over Clover, and anything not on the menu is hidden.
  for (const g of gs) {
    for (const m of g.mods) {
      const key = `${g.gid}::${m.n}`;
      if (NOT_ON_PRINTED_MENU.has(key)) {
        m.oos = true;
        offMenu.push(`${it.name}: "${m.n}" (${m.p}) is on the register but not the printed menu`);
        continue;
      }
      /* Deliberately app-only exclusion. Reported as a note rather than an
         issue: nothing is wrong in Clover, the shop just does not sell it here. */
      if (HIDDEN_IN_APP[key]) {
        m.oos = true;
        appHidden.push(`${it.name}: "${m.n}" ($${m.p}) — ${HIDDEN_IN_APP[key]}`);
        continue;
      }
      /* A day-locked modifier keeps its price and its place on the sheet; the
         lock only decides whether it can be picked today. */
      if (MODIFIER_DAYS[key]) m.days = MODIFIER_DAYS[key];
      if (MENU_PRICE[key] !== undefined && MENU_PRICE[key] !== m.p) {
        priceEdits.push({ item: it.name, group: g.name, option: m.n, clover: m.p, menu: MENU_PRICE[key] });
        m.p = MENU_PRICE[key];
      }
    }
  }
  if (ITEM_MENU_PRICE[it.id] !== undefined && ITEM_MENU_PRICE[it.id] !== base) {
    priceEdits.push({ item: it.name, group: "(item price)", option: it.name, clover: base, menu: ITEM_MENU_PRICE[it.id] });
    base = ITEM_MENU_PRICE[it.id];
  }

  for (const g of variants) {
    for (const m of g.mods) {
      const misfiled = MISFILED_AS_SIZE[`${g.gid}::${m.n}`];
      if (misfiled) {
        m.oos = true;
        issues.push(`${it.name}: "${m.n}" ($${m.p}) sits in size group "${g.name}" but is ${misfiled}`);
        continue;
      }
      if (m.p === 0) {
        m.oos = true;
        issues.push(`${it.name}: "${m.n}" in group "${g.name}" is priced $0 — would ring up free`);
      } else if (m.n.trim().toLowerCase() === it.name.trim().toLowerCase()) {
        // an option named after its own item, sitting in that item's size group,
        // is an add-on filed in the wrong place — it reads to customers as a size
        m.oos = true;
        issues.push(`${it.name}: "${m.n}" ($${m.p}) sits inside size group "${g.name}" and reads as a size`);
      }
    }
  }

  /* A single-select group must have something pickable on every day of the
     week. Hiding options and locking others by day can between them leave an
     item that renders a row a customer can tap and then cannot order — the
     dead row. If that ever happens the item wants an ITEM_DAYS lock so the menu
     greys the whole row with a reason, rather than a sheet with no choices. */
  for (const g of gs) {
    if (g.kind === "side") continue;
    const sellable = g.mods.filter((m) => !m.oos);
    if (!sellable.length) continue;          // wholly hidden group, handled above
    for (let day = 0; day <= 6; day++) {
      const open = sellable.filter((m) => !m.days || m.days.includes(day));
      if (!open.length) {
        issues.push(
          `${it.name}: group "${g.name}" has nothing selectable on ` +
          `${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][day]} — the row would be a dead end. ` +
          "Give the item an ITEM_DAYS lock so the whole row greys out instead."
        );
      }
    }
  }

  let lo, hi;
  if (variants.length) {
    const ps = variants[0].mods.filter((m) => m.p > 0 && !m.oos).map((m) => m.p);
    if (!ps.length) continue;
    lo = Math.min(...ps); hi = Math.max(...ps);
  } else {
    lo = hi = base;
  }
  if (lo <= 0) continue;

  /* An explicit pin wins, but only if the item really is in that category in
     Clover — otherwise the pin is a fiction and the item would appear under a
     heading the register does not agree with. */
  const pinned = ITEM_CATEGORY[it.id];
  const cat = pinned && cats.includes(pinned) ? pinned : cats[0];
  if (pinned && !cats.includes(pinned)) {
    issues.push(`${it.name}: pinned to "${pinned}" but Clover has it in ${cats.join(", ") || "no kept category"}`);
  }
  out.push({ id: it.id, name: it.name, cat, base, lo, hi, groups: gs });
}

/* ---------- emit ---------- */
const byCat = new Map(CATEGORY_ORDER.map((c) => [c, []]));
for (const i of out) byCat.get(i.cat)?.push(i);
for (const list of byCat.values()) list.sort((a, b) => b.hi - a.hi);

const q = (s) => JSON.stringify(String(s));
const modStr = (m) =>
  `{ n: ${q(m.n)}, p: ${m.p}${m.mid ? `, mid: ${q(m.mid)}` : ""}` +
  `${m.days ? `, days: ${JSON.stringify(m.days)}` : ""}${m.oos ? ", oos: true" : ""} }`;

let js = `// GENERATED FROM THE CLOVER INVENTORY EXPORT — do not hand-edit prices.
// Regenerate with:  npm run menu -- <clover-export.xlsx>
// Every id / gid is a live Clover object id, so an order maps 1:1 onto the register.
// Line price = base + selected variant modifier + side upcharges.
// Defaults to the first available option in each group (Clover's own ordering).
// oos:true marks a modifier Clover has mispriced; hidden rather than sold wrong.
// Generated ${new Date().toISOString().slice(0, 10)} from ${q(src.split("/").pop())}.
export const MENU = [
`;
for (const cat of CATEGORY_ORDER) {
  // A category with nothing in it would render as a dead chip in the app.
  if (!byCat.get(cat).length) continue;
  js += `  { cat: ${q(cat)}, sub: ${q(CATEGORY_SUB[cat])}, items: [\n`;
  for (const i of byCat.get(cat)) {
    const gs = i.groups
      .map((g) => `\n        { gid: ${q(g.gid)}, name: ${q(g.name)}, kind: ${q(g.kind)}, mods: [${g.mods.map(modStr).join(", ")}] }`)
      .join(",");
    const desc = DESC[i.id] ? `, desc: ${q(DESC[i.id])}` : "";
    const itemDays = ITEM_DAYS[i.id] ?? CATEGORY_DAYS[cat];
    const days = itemDays ? `, days: ${JSON.stringify(itemDays)}` : "";
    /* Every item carries a prep time, so nothing downstream has to guess. A
       no-prep item is marked rather than given minutes — the cart excludes it
       from the maximum instead of treating it as a fast plate. */
    const noPrep = NO_PREP_IDS.has(i.id) || NO_PREP_CATEGORIES.has(cat);
    const prep = `, prepMinutes: ${PREP_MINUTES[i.id] ?? DEFAULT_PREP}${noPrep ? ", noPrep: true" : ""}`;
    // Item name + every sellable modifier, flattened and normalised.
    const search = `, search: ${q(searchIndex(i))}`;
    js += `    { id: ${q(i.id)}, name: ${q(i.name)}, emoji: ${q(EMOJI[i.name] ?? "🍽️")}${desc}${days}, base: ${i.base}, lo: ${i.lo}, hi: ${i.hi}${prep}${search}, groups: [${gs}\n      ] },\n`;
  }
  js += `  ]},\n`;
}
js += `];

export const UE = ${JSON.stringify(UE, null, 2)};

/* Like-for-like everyday prices for the Friday platters, so a saving can be
   stated with the number it is measured against. See FRIDAY_COMPARISON in the
   generator, and docs/FRIDAY-PRICING.md for how each was worked out. */
export const FRIDAY_VS = ${JSON.stringify(FRIDAY_COMPARISON, null, 2)};

// Used for reward eligibility
export const DRINK_ID = "D7MBX5PWRCGCE";
export const SIDE_ID  = "6NX7XK602V0ZM";

// The six on the website's "What We're Known For". The Popular section in the
// app renders these same item objects — it does not copy them.
export const POPULAR_IDS = ${JSON.stringify(POPULAR_IDS, null, 2)};

/* Prep-time constants travel with the data so src/lib/prep.js has a single
   source for them and never re-declares a number the generator owns. */
export const DEFAULT_PREP_MINUTES = ${DEFAULT_PREP};
export const COOKED_TO_ORDER_MINUTES = ${COOKED_TO_ORDER};

export const CAT_OF = {};
export const PLATE_IDS = new Set();   // anything served with two sides
MENU.forEach((c) => c.items.forEach((i) => {
  CAT_OF[i.id] = c.cat;
  if (i.groups.some((g) => g.kind === "side")) PLATE_IDS.add(i.id);
}));
export const hasChoices = (i) => i.groups.length > 0;
`;

writeFileSync(OUT, js);

console.log(`Wrote ${out.length} items to src/data/menu.data.js`);
for (const cat of CATEGORY_ORDER) console.log(`  ${cat}: ${byCat.get(cat).length}`);

/* An Uber price that cannot support a claim. A flat number against a two-size
   dish was compared to the cheaper size and produced savings that were false at
   the other one — so it is reported until someone prices both sizes. */
{
  const bySize = new Map(out.map((i) => [i.id, i]));
  const ambiguous = [];
  for (const [id, price] of Object.entries(UE)) {
    const item = bySize.get(id);
    if (!item) continue;
    const multi = item.lo !== item.hi;
    if (multi && typeof price === "number") {
      ambiguous.push(`${item.name}: Uber $${price} against our $${item.lo} and $${item.hi}`);
    }
    if (!multi && typeof price === "object") {
      issues.push(`${item.name}: one price, but the Uber entry is per size`);
    }
  }
  if (ambiguous.length) {
    console.warn(`\n  ${ambiguous.length} Uber price(s) cannot support a saving — one number, two sizes:`);
    for (const a of ambiguous) console.warn(`    - ${a}`);
    console.warn(
      "    Which of our sizes is that Uber price? Until each size has its own\n" +
      "    number these show no comparison at all. Change the UE entry to\n" +
      "    { med, lg } and it comes back. See docs/UBER-EATS-PRICES.md."
    );
  }
}

/* A Friday comparison for an item that is not on Friday, or is not cheaper. */
for (const [id, cmp] of Object.entries(FRIDAY_COMPARISON)) {
  const item = out.find((i) => i.id === id);
  if (!item) { console.warn(`  ! FRIDAY_COMPARISON set for ${id}, which is not on the menu`); continue; }
  if (!(cmp.everyday > item.lo)) {
    issues.push(
      `${item.name}: Friday $${item.lo} is not below the everyday $${cmp.everyday} — ` +
      `remove it from FRIDAY_COMPARISON rather than claiming a saving`
    );
  }
}

// Warn about UE entries pointing at items that no longer exist
const ids = new Set(out.map((i) => i.id));
for (const id of Object.keys(UE)) {
  if (!ids.has(id)) console.warn(`  ! UE price set for ${id}, which is not on the menu anymore`);
}
for (const id of POPULAR_IDS) {
  if (!ids.has(id)) console.warn(`  ! Popular item ${id} is not on the menu anymore`);
}
for (const id of Object.keys(PREP_MINUTES)) {
  /* An item hidden on purpose is not on the menu and is not stale either — it
     keeps its prep time so un-hiding it does not silently fall back to 30. The
     warning is for keys whose item has actually left the export. */
  if (!ids.has(id) && !HIDDEN_ITEMS_IN_APP[id]) {
    console.warn(`  ! Prep time set for ${id}, which is not on the menu anymore`);
  }
}

/* A day lock on a modifier that no longer exists is a silent no-op, and the
   option it was meant to restrict would be orderable every day. */
{
  const seen = new Set();
  for (const i of out) for (const g of i.groups) for (const m of g.mods) seen.add(`${g.gid}::${m.n}`);
  for (const key of Object.keys(MODIFIER_DAYS)) {
    if (!seen.has(key)) console.warn(`  ! Day lock set for "${key}", which is not a modifier on the menu`);
  }
  for (const key of Object.keys(HIDDEN_IN_APP)) {
    if (!seen.has(key)) console.warn(`  ! HIDDEN_IN_APP names "${key}", which is not a modifier on the menu`);
  }
  for (const id of Object.keys(HIDDEN_ITEMS_IN_APP)) {
    // `items` is the Map of everything the export carried, before any filtering.
    if (!items.has(id)) console.warn(`  ! HIDDEN_ITEMS_IN_APP names ${id}, which is not an item in the export`);
  }
}

if (misattachedSides.length) {
  console.warn(
    `\n  !! ${misattachedSides.length} item(s) have the WRONG SIDE GROUP at the register !!`
  );
  for (const m of misattachedSides) console.warn(`    - ${m}`);
  console.warn(
    "\n    The standalone \"Side\" group prices every option as if it were sold\n" +
    "    on its own, and Clover adds it to the plate's base — so the register\n" +
    "    rings a $39.99 platter at $44.99 with white rice, and the app would\n" +
    "    have advertised it \"from $1\". The group is dropped from these items\n" +
    "    here, so they keep their real price and offer no sides at all.\n" +
    "\n    At the register, on each item: remove \"Side\", add \"Side With Meal\".\n" +
    "    Then delete the id from MISATTACHED_SIDE_GROUP and regenerate."
  );
}

if (appHidden.length) {
  console.log(`\n${appHidden.length} modifier(s) hidden from the app on purpose — still sellable at the counter:`);
  for (const a of appHidden) console.log(`  - ${a}`);
}
const undescribed = out.filter((i) => !DESC[i.id]);
if (undescribed.length) {
  console.warn(`\n  ${undescribed.length} item(s) have no description — add them to DESC in this script:`);
  for (const i of undescribed) console.warn(`    ${i.id}  ${i.name}`);
}

if (missingModifierIds) {
  console.warn(
    `\n  ${missingModifierIds} modifier row(s) in this export carry no modifier id.\n` +
    "  Clover order lines need one per selected modifier. The server resolves them\n" +
    "  by name against GET /v3/merchants/{mId}/modifier_groups?expand=modifiers at\n" +
    "  order time, so ordering still works — but a modifier renamed in Clover will\n" +
    "  stop resolving and the order will be refused rather than ring up wrong.\n" +
    "  If your export has a modifier id column under another name, add it to the\n" +
    "  lookup in this script."
  );
}

if (priceEdits.length || offMenu.length) {
  console.log("\n  PRINTED MENU APPLIED — the register does NOT know about these yet.");
  console.log("  Clover prices its own orders, so until you make these changes in the");
  console.log("  Clover dashboard the counter and the app will disagree.\n");
  for (const e of priceEdits) {
    const dir = e.menu > e.clover ? "raise" : "lower";
    console.log(`    ${dir.padEnd(5)} ${e.item} / ${e.group} / ${e.option}:  ${e.clover} -> ${e.menu}`);
  }
  for (const o of offMenu) console.log(`    hide  ${o}`);
  console.log("");
}

if (issues.length) {
  console.log(`\n${issues.length} pricing issue(s) in Clover — worked around here, still need fixing at the source:`);
  for (const i of issues) console.log(`  - ${i}`);
  console.log("\nSee CLOVER-FIXES.md.");
}
