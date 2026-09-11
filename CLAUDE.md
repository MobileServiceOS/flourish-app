# CLAUDE.md — working notes for this repo

Context for anyone (human or agent) picking this up. Read `README.md` for how to
run it and `CLOVER-FIXES.md` for what's wrong in the merchant's Clover account.

## What this is

A commission-free pickup ordering app for **Flourish bx inc**, 4035 Laconia Ave,
Bronx NY 10466. Pickup only — no delivery, no service fees, no platform cut.
React + Vite, wrapped with Capacitor for iOS/Android.

## The two rules

**1. The printed menu sets the price.** Where Clover disagrees, the menu wins and
the app shows the menu price. The overrides live in `MENU_PRICE`,
`ITEM_MENU_PRICE` and `NOT_ON_PRINTED_MENU` at the top of
`scripts/generate-menu.mjs`.

**2. Clover still charges the customer.** The app sends no line prices; Clover
prices its own orders, and the card is charged the total Clover returns. So rule
1 only reaches the app until the Clover dashboard is updated to match — until
then the app and the counter disagree on nine items. The generator prints the
exact changes needed on every run. See `PRINTED-MENU-PRICES.md`.

These two pull against each other by design, and rule 2 is the one that moves
money. Do not "fix" a price mismatch by making the app charge its own total: the
order in Clover would then disagree with the card, and the till goes out.

`src/data/menu.data.js` is generated and must never be hand-edited. A price that
looks wrong is either wrong in Clover or missing from the printed-menu maps —
fix it in one of those two places and regenerate. Menu copy, Popular ids and day-locks live in maps at the
top of `scripts/generate-menu.mjs` so a regen keeps them. Items the kitchen has
stopped making go in `DELISTED` there, by Clover id — they stay in the Clover
inventory long after they come off the menu.

## Architecture

```
browser                        server (node)                 Clover
────────                       ─────────────                 ──────
src/App.jsx      state owner
  components/    screens
  lib/clover.js  ──fetch /api──▶ server/app.js  ──Bearer──▶  apisandbox.dev.clover.com
  lib/cloverOrder.js  (shared, pure: cart → Clover payload)
```

### Why there is a server at all

`CLOVER_PRIVATE_TOKEN` can create orders and charge cards. Vite inlines every
`VITE_*` variable into the browser bundle, so that token deliberately has **no**
`VITE_` prefix and is only ever read by `server/env.js`.

The browser gets `VITE_CLOVER_PUBLIC_TOKEN`, which can tokenize a card but not
charge one. Card numbers go straight from Clover's hosted iframes to Clover; our
JavaScript only ever sees a single-use token.

A test asserts the private token is absent from `dist/` — see
`src/test/cloverUi.test.jsx`.

### Two things the server refuses to trust from the client

1. **Prices.** Every line is re-priced from Clover's own modifier catalog before
   the order is built. The client's prices are display state.
2. **Modifiers resolving.** Most plates are stored `base: 0` with the real price
   in a size modifier group, so an order whose modifications don't resolve rings
   up an **Oxtail at $0.00**. Unresolved modifiers throw and the order is
   refused — a rejected order is recoverable, a free plate isn't.

### Closed means closed

Opening hours are enforced in three places, and only one of them is real:

- the cart will not go to checkout, and says when the shop opens
- the checkout's pay button disables, re-checked on a minute tick
- **the proxy refuses `POST /orders` and `POST /pay` with 409 CLOSED**, and
  refuses with 409 TOO_LATE_TO_COOK when the order could not be ready before
  close even though the shop is open right now

The first two are a courtesy to an honest client. A tab left open past closing,
or a request replayed by hand, is stopped by the third. Do not remove it on the
grounds that the UI already prevents it.

Hours are New York wall-clock. `server/index.js` pins `process.env.TZ` before
anything reads a clock, because Railway, Fly and most containers run in UTC —
where 11am-10pm local would have the Bronx open from 6am.

### Sales tax

`TAX_RATE` in `src/lib/money.js` is **8.875%**, and that constant is the only
place the rate appears. It used to be a bare `0.08875` in three files, which is
how the number shown at checkout and the number charged to a card drift apart.
A test fails the build if a rate literal reappears outside `money.js`.

Two things to know:

- **This rate is only the estimate shown to the customer.** The atomic order
  deliberately carries no tax field; Clover applies the merchant tax rules when
  it prices the order. So `TAX_RATE` must match the rate configured in the
  Clover dashboard, or the checkout total and the till disagree.
- **The card is charged what Clover priced**, falling back to the local estimate
  only when Clover does not return a total. Clover is the register — if the two
  ever disagree, the card follows the order, not the app.

8.875% is the combined New York City rate on prepared food: 4% state + 4.5%
city + 0.375% MCTD. It was 8.5% for a while, set deliberately on request, and
was corrected in `dba387e`.

### Launch screen

`src/components/Splash.jsx` puts the real logo at the centre with a ring of SVG
petals unfurling around it — their transform-origin is the ring centre, so
scaling one from 0 opens it outward. Pure CSS keyframes, staggered 0.05s per
petal, no animation library. The petals sit *outside* the artwork rather than
behind it: the logo has its own flowers and hummingbirds, and doubling them up
looks like clutter.

It holds until **both** the bloom has had its ~2.5s **and** the account has come
back, so a slow storage read never cuts it short and a fast one never flashes
past. Only the first launch in a session plays it — `sessionStorage`, see
`lib/splashSession.js` — but the splash still covers the account read on every
later launch, because that is what stops the sign-in pitch flashing at a
customer who already has an account. Those are two separate gates and collapsing
them reintroduces the flash.

The exit is a class, not a keyframe on a timer, for the same reason.

### The launch screen on a device

Two things broke it on real hardware, neither visible in a browser:

**`sessionStorage` persists in a WKWebView.** The "already played" flag was
stored there on the assumption it dies with the tab — true in a browser, false
in Capacitor, which keeps the web view's data store across app launches. The
splash played once ever and never again. It is a module variable now: cold
launch gets a new JS context and replays, resume from the lock screen does not.
`splashSession.js` never writes storage; it only *reads* an override the test
setup sets so the suite is not 2.5s slower per render.

**The logo was 614KB and did not arrive in time.** The ring animated around an
empty centre. It is now sized for what it displays at (760px), served as WebP
with a PNG fallback, and preloaded in `index.html`. A test pins the file size.

### App icons

`npm run icons` builds the whole set from `brand/logo.png`.

**Order matters.** `npx cap sync` restores Capacitor's placeholder
AppIcon.appiconset over whatever is there, so icons must be generated *after*
sync or the home screen shows a generic icon. `npm run sync` chains
build -> sync -> icons for exactly that reason; do not run `npx cap sync` on its
own and stop there.

Two things that silently break an iOS catalog, both now guarded by tests:
alpha channels (Apple rejects them) and tagging a 1x icon as `iphone` — iPhone
has no 1x sizes, so Xcode ignores the entry.

### Dev ports

`5180`, pinned with `strictPort`. Other projects on this machine hold 5173 and
5174, and Vite's default behaviour is to move on silently — which meant a phone
pointed at the remembered URL loaded a different app entirely and its `/api`
went to somebody else's server. Failing loudly keeps the URL honest.

The `/api` proxy needs no special config for phones: Vite proxies server-side,
so the phone talks to Vite and Vite talks to 3001.

### Hours and the ready window

Open **11AM**, closing 10PM Sunday to Thursday and 11PM Friday and Saturday.
All of it comes from `src/lib/hours.js` — `OPEN_HOUR`, `closeHourFor`,
`HOURS_LINE` — and every screen reads those constants rather than repeating a
time. The printed trifold still says 9AM-10PM daily and is now the stale one.

**There is no ASAP, and no single prep constant.** Fish, seafood and lamb are
cooked to order and cannot be promised in fifteen minutes, so how long an order
needs depends on what is in it. `src/lib/prep.js` owns that:

- every item carries `prepMinutes`, baked into `menu.data.js` from the
  `PREP_MINUTES` map in `scripts/generate-menu.mjs`, keyed by **Clover item id**
  so it survives a regeneration. Default 15; 30 for cooked-to-order
- a cart takes the **maximum** of its lines, never the sum — the kitchen cooks in
  parallel, and six plates are ready when the slowest one is
- sides and drinks are marked `noPrep` and excluded from that maximum, so a Coke
  can never be the thing that decides when an order is ready
- an item id we do not recognise resolves to **30**, never 15. It is either new
  in Clover or something has gone wrong, and in both cases fifteen minutes is a
  promise we cannot keep

The window is `[now + prep, +10 min]`, both edges rounded to the nearest five
minutes, rendered as `2:10–2:20 PM`.

**It is computed on the server and only displayed by the client.** `POST
/api/clover/quote` takes a cart and returns the window, the prep time, the
bookable slots and whether it can be cooked before close; the cart and checkout
render what comes back, and show "checking with the kitchen" rather than a
number when they have not been told one yet. `hours.js` and `prep.js` throw
rather than defaulting when a caller forgets to pass a prep time — a default
would quietly reintroduce the bug it exists to remove.

The same window label goes on the kitchen ticket and into the confirmation
message, so the screen, the ticket and the text cannot disagree.

### The hours guard is about the READY time

Being open is not enough. At 9:50PM the door is unlocked, but a 30-minute plate
would come out of the fryer twenty minutes after close and the kitchen would be
gone. So `POST /orders` refuses when the *end of the window* falls after closing
— with a reason naming the prep time and the closing time — on top of the plain
closed check. Server-side, not just in the UI, for the same reason as everything
else here: a stale tab and a replayed request must both hit it.

### Pay at pickup

The app takes no money. An order is pushed to Clover with **no payment
attached**, which leaves it open and owing at the register, and the ticket says
so in words — `PICKUP ORDER — PAY AT REGISTER` is the first line of the order
note, because nobody reads state codes off a printed ticket.

The order number is minted on the client *before* the order is sent, so the
kitchen ticket and the customer's screen show the same `FL-1234`. Deriving it
from the Clover id afterwards, which is what it used to do, meant the printed
ticket could not carry it.

### The ticket must name a customer

The note is exactly this, in this order:

```
PICKUP ORDER — PAY AT REGISTER
Order FL-3412
Kay K · (347) 555-1234
Pickup: 2:10–2:20 PM
Reward: Free drink          <- only when one was redeemed
```

A live order printed with only the first, second and fourth lines: staff had a
bag of food and nobody to give it to. Two things caused it, and both are fixed:

- `App.jsx` sent `customer: account ? {...} : null` — the saved *account*, not
  the name and phone typed into the checkout. Every guest order, and every
  signed-in customer who corrected their number, sent no customer at all
- `kitchenNote` was written `if (customer?.name)`, so it dropped the line in
  silence rather than complaining

So the name and phone now come from the checkout fields, `kitchenNote` throws
without them, and **the proxy returns 400 before anything reaches Clover**. An
order nobody can be handed is worse than an order that was never taken. The
customer lines also sit above the optional ones, so a note trimmed to Clover's
255-character cap keeps what staff actually need.

The proxy still finds-or-creates the Clover customer by phone and attaches them
to the order, so the register shows them too — but that is best effort and
individually caught, because the ticket already carries the name and number.

### Customer messaging

After an order is created the proxy sends a confirmation through Clover's own
messaging, quoting the window this order was actually given.
`POST /api/clover/orders/:id/ready` is the staff action: it flips the order to
fulfilled — which is what the customer's tracking screen polls for — and sends
the ready message.

**Messaging is detected once, at startup, and then left alone.** Clover's order
messaging is not on this merchant's plan: every attempt answers `405 POST not
allowed`. `probeMessaging` POSTs to the messages path with a sentinel order id —
405 means the path is not routed at all, while a 404 would mean it is routed and
merely disliked the sentinel. On 405 it logs **one line** and skips messaging for
the rest of the process.

It used to warn on every order, for a feature that was never coming back within a
session — and because printing was failing with the *same* 405 for a completely
unrelated reason, that noise is part of what buried the print bug. Messaging and
printing now share no error handling at all, deliberately.

An order must never be lost because a text could not be sent, so a failure is
still reported as `messaged: false` and otherwise ignored.

Phone numbers print on tickets, so `maskPhone` in `server/app.js` reduces them to
`(***) ***-**13` before anything is logged.

### Printing the ticket

**The URL is merchant-scoped, and getting that wrong cost three rounds:**

```
POST {API_BASE}/v3/merchants/{mId}/print_event
{"orderRef":{"id":"<orderId>"},"printer":{"id":"<printerUuid>"}}
```

The order is named by `orderRef` in the **body**. It does not go in the path.
This was `/v3/merchants/{mId}/orders/{orderId}/print_event`, which Clover does
not route — and an unrouted path answers `405 POST not allowed`, the identical
response a made-up endpoint gets. So printer discovery worked, the right printer
was chosen, the body was correct, and every single ticket still 405'd, with a
status that said nothing about the path being the problem.

`PRINT_EVENT_PATH` and `printEventUrl()` are exported and pinned by tests that
assert the URL character for character, that it contains no `/orders/`, that it
is not pluralised, and that it has no doubled slash — plus tests that intercept
`fetch` and check the method, headers and body that actually go on the wire, so
a wrapper rewriting the method could not slip through either.

The startup banner prints the resolved URL on every boot, `/health` carries it,
and **every print failure logs the status and the URL together**. A bare
"405 POST not allowed" with no URL is what made this so hard to find.

`server/clover.js` owns the rest. On first need it reads the merchant's printers
and caches the list for ten minutes, then chooses one:

`CLOVER_PRINTER_UUID` → type `order` → `kitchen` → `fiscal` → `receipt` →
`MY_LOCAL` → **the first printer in the list, whatever its type**.

That last fallback is the actual fix. This merchant has exactly one printer —
the Station's built-in roll, type `MY_LOCAL` — and it was not on the old
selection list, so nothing was ever chosen and the server's print never fired.
Worse, the `print_event` named no printer at all, and Clover routes those
nowhere. **Selection never returns null while the list is non-empty**: a ticket
on the wrong roll is a nuisance, a ticket on no roll is an order the kitchen
never sees.

`printOrderTicket` retries once after two seconds, and on a **404** re-reads the
list and tries the new choice instead — a 404 means the printer is gone, not
busy, so waiting achieves nothing. It never throws; it returns
`{ printed, printer, printError }`.

Printing is still best effort and must never fail an order. But the result is
reported honestly now, and the confirmation screen is driven off the real flag —
it used to tell customers "the kitchen printer didn't answer" on orders that had
printed perfectly well.

Visibility, because a silent printer is how an order reaches Clover and never
reaches the kitchen: the startup banner names the chosen printer (and shouts
when there are none), `/health` carries `printerConfigured`, `printerName` and
`printerType`, `GET /api/clover/printers` shows the list and the choice, and
`POST /api/clover/print-test` reprints the most recent app order. `print-test`
fires a real print, so it sits behind `APP_KEY` like everything else — and it
**always answers in JSON**, including when there is no order to reprint and when
the print fails, with the status and resolved URL in the payload. It used to
return an empty body on the no-order path, which gave `curl` nothing to parse and
made the diagnostic tool need its own diagnosing.

### Searching the menu

Customers search for the dish, not for the row it lives in. "sweet chili
salmon", "escovitch", "honey garlic" are all **modifiers**, and a name-only
search returned nothing for every one of them.

Every item carries a generated `search` string — its name plus every sellable
modifier across every group — built by `searchIndex()` in
`scripts/generate-menu.mjs`, so renaming a flavour in Clover renames it in
search on the next regeneration. It is never hand-maintained, and a test rebuilds
it from the committed data and fails on any drift.

**Two things are left out of the index.**

*oos modifiers*, because surfacing a plate through a flavour we refuse to sell is
worse than not matching: the customer taps the row and the option is not on the
sheet. Descriptions are searched too but rank below the index, and a description
word that names an oos modifier is stripped — Salmon's copy still reads
"...grilled, or steamed" while Steamed is off the menu, and matching that text
would undo the rule.

*The shared "Side With Meal" group*, because it is the same fourteen options on
some twenty plates. Indexing it meant any query containing a side word matched
nearly the whole menu — "mac and cheese" returned twenty rows. Options that
appear everywhere carry no information about which plate you wanted. Sides are
separately sellable, so the standalone Side item keeps its own group (named
"Side", kind `variant`) and "mac and cheese" finds it there, alone.

`src/lib/search.js` owns matching and ranking. Every query word must appear
(AND, not OR) and word order never matters. Ranking is a score, not a tier,
because the interesting cases are otherwise all ties:

- an exact item name wins outright, so "shrimp" leads with the Shrimp plate
- a query word the NAME accounted for is worth far more than the same word in an
  options list
- a description-only match is worth least, since the copy goes stale against the
  data — Salmon's still lists flavours that are off the menu

When an item matched on a modifier, the sheet **opens on that modifier** —
finding "sweet chili salmon" and landing on a sheet defaulted to Grilled is worse
than no match, because the dish was found and then hidden. Only dish-defining
groups are preselected: a side is what comes *with* the plate, and swapping
someone's rice because a search word brushed against it is not a search box's
decision.

One thing to know about the data: **"Fried" under Shrimp was wrongly flagged
off-menu.** The shop sells fried shrimp — it is a real flavour inside the Shrimp
item's own group — and the oos flag hid it from customers and from search, which
is why "fried shrimp" once only reached Shrimp by accident, through the "Fried
Chicken" side. There is no separate Fried Shrimp item in Clover and there should
not be one: Clover has a single Shrimp item with its flavours inside it, and the
fried shrimp *side* is the existing $5 Shrimp modifier.

### Day locks: items and modifiers, one mechanism

Some dishes are only cooked on certain days. So are some **options inside a
group**: Soup is one Clover item (`9WV3BMMSC8G5E`) whose six sizes are three
different soups, and the kitchen makes them on different days.

| | Window |
|---|---|
| Soup — Medium/Large **Seafood** | Fri, Sat |
| Soup — Medium/Large **Chicken** | Sun–Thu |
| Soup — Medium/Large **Goat** | every day, no lock |
| Seafood Stew Peas (item) | **Fri only** — was Fri+Sat, corrected |
| Seafood Fridays (category) | Fri |

Three declarations in `scripts/generate-menu.mjs`, all keyed the way the rest of
the maps are: `CATEGORY_DAYS` by name, `ITEM_DAYS` by Clover item id,
`MODIFIER_DAYS` by `"<group id>::<modifier name>"`. Clover has no concept of a
day-limited anything, so these maps are the only place that knowledge lives, and
`modStr` emits `days` onto the modifier so a regeneration carries it.

`src/lib/availability.js` is the **single** evaluation. The proxy and the sheet
both call it, so they cannot disagree about whether today is Friday.

**The day is always New York's day.** `new Date().getDay()` is the *device's*
idea of the day: a customer in London at 1am Saturday is still in Friday evening
as far as the kitchen is concerned, and a container in UTC crosses midnight five
hours early. Both would offer or refuse the wrong food, so `dayOfWeek()` names
the zone through `Intl` rather than inheriting it. That makes it independent of
the `TZ` pin in `server/index.js`, which stays for the hours logic.

**A locked option is shown, greyed, with the reason** — "Fri & Sat only" in
place of its price — not hidden. An option that vanishes four days a week reads
as "they stopped making it". It cannot be picked by pointer or keyboard, and the
sheet's default selection skips it: defaulting to `!m.oos` alone would open the
soup sheet on seafood on a Tuesday, priced for something the proxy then refuses.
Search preselection is filtered the same way.

**Enforced server-side, in the same pass as the item locks.** `POST /orders`
refuses with `409 NOT_AVAILABLE_TODAY`, listing everything unavailable rather
than only the first, because a customer fixing one problem at a time is a
customer giving up. Greying the sheet is a courtesy to an honest client; a tab
left open overnight or a replayed request is stopped by the proxy, same as
hours.

`daysLabel` collapses runs: `[0,1,2,3,4]` reads "Sun–Thu only", not
"Sun & Mon & Tue & Wed & Thu only".

**Goat soup is hidden, not repriced.** Sold at the counter, not orderable in
the app: `HIDDEN_IN_APP` in the generator marks `VXX7556SJGA38` /
`BA4HKW7B2FDY4` oos, so they never render and never reach the search index.
Three distinct reasons an option gets hidden, kept separate so the reason
survives — `NOT_ON_PRINTED_MENU` (on the register, not on the menu),
`MISFILED_AS_SIZE` (a dish in another item's size group), `HIDDEN_IN_APP`
(deliberate app-only exclusion).

The old `MENU_PRICE` override that put $5/$10 on those sizes is **gone**. It
existed so the app could sell a dish Clover prices at $0; with the dish hidden
there is nothing for a customer to see, so the override was the app papering
over a dashboard problem for no benefit. The $0 at the register is real and
still wrong, and stays CLOVER-FIXES #2.

That leaves Soup as chicken (Sun–Thu) and seafood (Fri–Sat), which between them
cover all seven days — **two selectable sizes every day, no dead row.** Both the
generator and a test check that property across the whole menu rather than
trusting it: hiding options and locking others by day could otherwise leave a
row a customer can tap with nothing behind it. If it ever happens the item wants
an `ITEM_DAYS` lock so the whole row greys out with a reason.

**Seafood Stew Peas is large only.** A flat $30 item with no size group in
Clover, and nothing in the app implies otherwise: no variant or flavour group,
`lo === hi` so it renders one price rather than a range, `sizePrices` returns
null so there is no "Med · Lg" row, `hasChoices` is false so it adds in one tap
instead of opening a chooser, and its own copy says "One size, large." The
search index is just its name, so "medium stew peas" cannot reach it. Tests
assert the absence of a SIZE choice specifically, not the absence of groups —
`Side With Meal` is queued to be attached at the register, and when it is this
item gains a sides picker and should still have no sizes.

**Why the Seafood stew-peas `oos` flag is NOT a day lock.** Now that modifier
locks exist, `KR1HHY64E4QPJ::Seafood` ($30, `QT4GSARF6ZHV8`) could have become
`[5]` instead of a hide — and it should not. That modifier is a $30 "size" of
ordinary Stew Peas, and the dish exists as its own item (`32VDQ4G5J131P`). A day
lock would make it *selectable on Fridays through the wrong item*, ringing up as
Stew Peas with a size modifier rather than as Seafood Stew Peas — a different
Clover line, a different ticket, and the item's own Friday lock bypassed. The
flag is not standing in for a missing day mechanism; it is hiding a structural
mistake in Clover. The fix is to delete that modifier from the Stew Peas group
at the register. See CLOVER-FIXES.md §5.

### Sides, and why "Included" was wrong

A side costs a different amount depending on what it is attached to, and **Clover
already models that correctly**: "Side With Meal" (`YQWN3PKBKV9NG`) and the
standalone "Side" (`S032100JQ3P4T`) are separate modifier groups holding separate
modifier *objects*. Festival is `T4SQAVXQ7MJ1E` at $0 with a plate and
`SJ27CE6ZE34BW` at $1 on its own. Context-dependent pricing needs no special
handling — it falls out of the data, and nothing forces one price per side.

Nothing was ever hardcoded. The sheet prints `m.p ? "+$X" : "Included"`, and
"Included" means one thing only: **Clover says $0.00**.

The problem was narrower. Clover has several meal-group sides at $0 by mistake,
and once that reaches the app, $0 is indistinguishable from "included" — so the
sheet said Fried Chicken was free with a plate, truthfully about the register and
wrongly about what the shop means to charge. Note the direction: the register
charged $0 too, so the shop was losing the money and no customer was surprised.

Three sets, declared outright in `scripts/generate-menu.mjs`:

- `SIDE_UPCHARGE` — priced with a plate. Shrimp $5 and Seafood Mac $3.50 are
  already right in Clover; **Fried Chicken $6 and Whiting Fish $2.50 are not**,
  and are applied by decision from the standalone prices.
- `SIDE_FREE_WITH_MEAL` — Festival and Pasta: $0 with a plate, own price alone.
  Declared to be *asserted*, not applied; the data already behaves this way.
- everything else — included, and asserted to be $0. A price appearing on one is
  reported as an issue rather than silently charged.

**THE TWO OVERRIDDEN SIDES MAKE THE APP QUOTE MORE THAN THE TILL TAKES, TODAY.**
Queued at the Clover dashboard: `W63ZR0Q92XER4` → $6.00 and `WHGNBP3G67PJP` →
$2.50 in Side With Meal. Until those land this is live on all 19 plates sharing
the group. See PRINTED-MENU-PRICES.md, where it is the largest entry. Clover
prices its own orders and has them at $0, so until the dashboard is corrected the
customer pays *less* at the counter than the app said. That is the rule-1 /
rule-2 divergence again, but in the opposite direction from the nine items in
PRINTED-MENU-PRICES.md — worth knowing before someone "fixes" it. See
CLOVER-FIXES.md §6.

Pepper Shrimp is deliberately absent: it is a standalone side only and is not in
the meal group at all, so it cannot be offered with a plate without a Clover
change.

### Special instructions

"gravy on the rice", "no veg", "extra spicy". They ride on
**`lineItems[].note`**, and that was verified printing on the real Station —
ticket FL-4212 came out as:

```
1  Jerk Chicken
   Jerk Chicken: Medium; Side With Meal: 2 White Rice
   No veg
```

Indented under the plate they belong to, which is where a cook needs them. At
the bottom of the order "no veg" names no dish.

**There is therefore no 255-character budget to ration.** The instructions and
the customer's details live in different Clover fields. An earlier design capped
each line's instructions and ranked truncation priority so the customer's name
would survive; none of that machinery was needed and none of it exists. The
`Note:` line in `kitchenNote` is gone too — it was dead code that nothing ever
populated.

`cleanLineNote` in `cloverOrder.js` enforces **140 characters and strips control
characters**, server-side. The input's `maxLength` is a courtesy to an honest
client; a crafted request would otherwise put arbitrary bytes on a thermal
printer, where a bare ESC can arrive as a command rather than as text. Tabs and
newlines collapse to a space so the words survive; the rest of the control range
is dropped.

The field shows a countdown only past 100 characters — a counter sitting at 140
from the first keystroke is noise on a field most people leave empty. It is
**editable from the cart**, because it used to be a read-only chip and changing
"no veg" meant deleting the line and walking the whole sheet again.

**It is not an allergy channel**, and says so: *"For allergies, please call the
restaurant."* The kitchen may not read a free-text box in time, and someone
trusting it could be harmed.

### Curbside

People double-park on Laconia and get ticketed, so "I'll wait in my car" is the
reason a lot of customers will use the app at all. Off by default — most collect
at the counter, and a toggle starting on would put CURBSIDE on every ticket.

The vehicle description goes in the **order** note, directly under the name and
phone, because it changes what staff *do* with the bag:

```
PICKUP ORDER — PAY AT REGISTER
Order FL-3412
Kay K · (347) 555-1234
CURBSIDE — BRING OUT TO: Blue Honda Civic · ABC1234
Pickup: 2:10–2:20 PM
```

Shouted for the same reason PAY AT REGISTER is: nobody reads a ticket carefully
during a rush. The order *title* carries ` · CURBSIDE` too, since staff triage
the Clover order list without opening anything.

The description is required once the toggle is on, enforced in the proxy with
`400 VEHICLE_REQUIRED` — a ticket telling staff to walk food out to a car they
cannot identify is as unactionable as an order with no customer. A description
left behind by a toggle switched off again is ignored rather than sent.

Note trimming protects it: the floor is header, order number, customer,
curbside and pickup window, so only the reward line is expendable. It is already
a real Clover discount on the order, so losing the words costs nothing.

Surfaced on the **menu** screen as well as at checkout. Nobody discovers a
checkout toggle they never reach, and avoiding the ticket is the selling point.

### Grouping line items

Orders are created with `groupLineItems: true`. Ten of the same plate was
printing as ten identical blocks instead of "10 Oxtail", which runs a ticket off
the end of the roll and makes a cook miscount. Clover collapses only lines whose
item, modifications and note all match, so two oxtails with different sides — or
one with a special instruction — stay separate, which is what the kitchen needs.

### The proxy on the internet

`server/guard.js` is what makes hosting it safe: a per-IP rate limit, an origin
allowlist, a ceiling on any single charge, and an app key.

Be clear about the app key — it ships in the browser bundle and **is not a
secret**. It turns away drive-by scanners and nothing more. The protections that
actually hold are the ones that do not rely on the caller being honest, and the
one real secret, `CLOVER_PRIVATE_TOKEN`, never leaves the server.

With no `APP_KEY` set the proxy serves localhost and **refuses remote callers
outright**, rather than sitting open. Set `APP_KEY`, `ALLOWED_ORIGINS` and
`MAX_CHARGE_DOLLARS` before deploying.

### Points are earned at the register, not in the app

The app takes no money. An order leaves here **open and owing**, and the
customer pays at the counter — or walks out and never collects it. Points used
to be added the moment the order was placed, which gave them away for food
nobody had paid for.

They are awarded on one thing only now: Clover confirming the payment.

- `GET /api/clover/orders/:id/status` reports `{ paid, voided, settled, ... }`
- `useOrderPayment` polls it every **30 seconds** from the tracking screen, and
  stops the moment the answer is final — paid, or voided at the register. It
  also gives up after two hours, for a customer who never came back
- on `paid`, `App.awardPoints` credits the order's `earnable` and the screen
  says **"Points earned!"**

If the app is closed before the customer pays, no points are awarded. They had
not been earned, so nothing was lost.

**Never award on order creation.** Two guards keep the award to exactly once:
`pointsAwarded` is persisted on the order and survives a relaunch, and an
in-memory `awardedRef` catches two polls landing in the same tick, which the
persisted flag cannot because React has not re-rendered between them.

`earnable` is computed and stored when the order is placed, while the cart still
exists — re-deriving it at payment time would read an emptied cart as zero.

Reading the payment state is deliberately strict, because a wrong "yes" gives
points away and a wrong "no" only means the screen waits another thirty seconds.
`paymentStatus` in `server/clover.js` trusts either Clover's `paymentState`
summary **or** the payments themselves adding up to the total: a split payment
leaves the summary `OPEN` while the money is all there. Failed payments and
refunds are subtracted, a zero-total order with no payments is never "paid in
full", and a deleted order is voided no matter what its summary says. A 404 from
Clover is an *answer* — the order was voided — not an error, so the client stops
polling and awards nothing.

### Clover loyalty, if the merchant ever turns it on

If the merchant runs Clover's own loyalty programme, its rules are the ones that
count — two schemes disagreeing about a customer's balance is worse than either
alone. `GET /api/clover/loyalty` reports which is in force, cached 30 minutes.

**This merchant has none.** Probed live: every loyalty path answers `405 GET not
allowed`, which is exactly what Clover says for a path it does not route at all —
a made-up endpoint returns the identical response, while real endpoints return
200. So 404 and 405 both mean "no programme here", and the in-app scheme runs.

Because of that, **the Clover branch has never run against a live programme.**
That is why `cloverEarnRate` in `src/lib/loyalty.js` returns `null` rather than a
guess when it does not recognise the payload: an earn rate invented from a field
name that turned out to mean something else would quietly credit every customer
the wrong number. Points are only ever computed from a rate we actually
understood, and an unrecognised programme falls back to 1 point per dollar.

### Order-ready notifications

`src/lib/notify.js` schedules a **local** notification on the device for the
estimated ready time. No server, no device tokens, no APNs account, nothing paid
per message. It survives three environments: Capacitor when native, the browser
Notification API otherwise, and silently nothing where neither exists.

The permission prompt lives on the confirmation screen, not at launch — the
customer is waiting for food there, so the reason is obvious and iOS only lets
you ask once. A refusal is final and handled without nagging; the in-app live
status is always the fallback.

Known limitation, stated in the UI: it fires on a timer, not when the kitchen
actually finishes. Stage 2 replaces the schedule with a server-sent push the
moment Clover flips the order to ready. `notify.js` is the seam for that.

**Never promise a text message.** The app sends no SMS and there is no Twilio
integration. A test fails the build if "we'll text you" wording reappears.

### Order of operations when placing an order

Push the order to Clover **first**, charge **second**. A charged customer with no
ticket on the register is the one failure staff can't fix at the counter; an
uncharged order that exists is just "pay at pickup".

## Environments

`CLOVER_API_BASE` in `.env.local` decides everything:

- contains `sandbox` → a red **SANDBOX** badge shows in the app header
- `https://api.clover.com` → badge disappears on its own

The server refuses to boot against a non-sandbox host unless
`CLOVER_ALLOW_PRODUCTION=yes` is also set. That guard exists so a stray edit
can't start billing real cards.

## Running it

```bash
npm run dev:all     # frontend (5173) + proxy (3001)
npm run dev         # frontend only — app runs in preview mode
npm run server      # proxy only
npm test            # 563 tests
```

Preview mode is a real, tested state: if the proxy isn't running the app still
browses, searches and builds a cart, and the checkout says *"App is in preview
mode — ordering is not connected yet"* rather than throwing.

### Copy cannot claim what the data contradicts

Salmon's description read "…grilled, or steamed" while Steamed was hidden, so
the row advertised a flavour the sheet would not offer. It was found by
accident, which is the problem: menu copy lives in a hand-maintained map and the
data it describes is generated from Clover, so the two drift silently and only
in one direction — the copy stays stale and keeps promising.

`src/test/copyClaims.test.js` checks every claim a name or description can make
against the data that would have to honour it: sides promised without a side
group, "one size" against a size picker, a named flavour that is hidden, a day
named without a day lock, "cooked to order" against the prep time. A human
re-reading 32 descriptions after every regeneration is not a control.

It found the same bug class five more times: five Friday platters named
"(Shrimp & 2 Sides)" with no side group at all. Three are hidden from the app
now; the other two are in `PENDING_AT_REGISTER` — an allowlist that **cannot
rot**, because a test fails the moment either item actually has the group,
forcing the entry out.

Two things it deliberately does not flag. "Made to order" is marketing copy and
says nothing about minutes, so only the app's own term — "cooked to order",
which the item sheet prints on a chip — is treated as a timing claim; Wings
reads "Made to order" at 15 minutes and that is accurate. And the day-word
pattern matches whole words only, after `\b(fri)\w*\b` matched **"fried"** in
Shrimp's flavour list and reported a day claim that was not there.

## Audits worth reading before you trust a map

Two documents record things measured against the live register rather than
assumed. Both were written because a comment that read like a reason turned out
to be a guess.

**`docs/HIDE-REASONS-AUDIT.md`** — all 21 `DELISTED` / `NOT_ON_PRINTED_MENU` /
`MISFILED_AS_SIZE` / `HIDDEN_IN_APP` entries, checked against Clover and against
600 orders of sales history. 3 verified, 2 wrong, **8 with no stated reason at
all**, and **6 that are still actively selling** — `F0Q8615QD5HMM::Wings` alone
sold 185 times in the sample and the app will not sell it. Read it before
adding another exclusion, and give the next one a reason.

Acted on since: **Wings, Jerk salmon, Curry Goat and the Oxtail lunch special
are un-hidden** — the one reason that could have justified keeping them was a
lunchtime window, and they sell 10:00 to 21:00, so "Lunch Specials" is a price
tier and not a time restriction the app would have to model. BBQ Chicken and
Curry Chicken stay hidden for a *pricing* reason instead of a menu one: both are
$0.00 in Clover and would ring free.

**`docs/FRIDAY-PRICING.md`** — nothing is deleted from Clover. Three Friday
SKUs are hidden from the app (`HIDDEN_ITEMS_IN_APP`) because fish, salmon and
shrimp are *flavour-defined* and a Friday SKU with no flavour group is a worse
version of a dish already on the menu; crab legs and lobster have no flavour
group even on the everyday item, so sides are the whole identity and they are
kept. Also carries the number worth a decision: **crab legs with shrimp is
$55.00 midweek against $39.99 on the flyer**, and **there is no mechanism for a
Friday price** — the app sends no line prices, Clover has no day-dependent
pricing, and the day locks govern availability rather than cost.

**`docs/EXPORT-VS-CLOVER.md`** — the curated xlsx export is now a *subset* of
the register. Live Clover has **no Drinks category** (both drink items sit in
Lunch & Dinner, which would also cost them their `noPrep` flag) and **15
Breakfast items**, twelve of them at $0.00. A regeneration from live Clover
today empties the Drinks section and adds a dozen free porridges. The export is
doing real filtering that has never been written down.

## Known blockers

**The credentials now work, and they point at PRODUCTION.** `.env.local` has
`CLOVER_API_BASE=https://api.clover.com` with `CLOVER_ALLOW_PRODUCTION=yes`, and
the server authenticates: a boot against it reads the merchant's real printer
list and finds `ZVZ9PRJ255V90`, type `MY_LOCAL`. The old note here said every
endpoint returned 401; that is out of date.

Be aware of what that means. There is no SANDBOX badge, and an order placed
through this app lands on the real register as a real open ticket. Nothing is
charged — the app takes no money — but a test order is a real order somebody has
to void. `POST /api/clover/print-test` prints a real ticket on the shop's
printer, so do not fire it casually.

`VITE_CLOVER_MERCHANT_ID` also has a trailing `/` in `.env.local`. The server
strips it, but it's worth fixing at the source.

**No per-modifier ids in the menu export.** The inventory export carries modifier
*group* ids but not modifier ids, which Clover needs on an order line. The server
resolves them by name at order time against
`/v3/merchants/{mId}/modifier_groups?expand=modifiers`. This works, but a
modifier renamed in Clover stops resolving and the order is refused. If a future
export includes a modifier id column, `scripts/generate-menu.mjs` already picks
it up under several likely names and bakes it in, which removes the fragility.

## Testing conventions

Tests live in `src/test/`. They favour asserting on things that cost real money
or lose a customer, rather than on markup:

- pickup slots at the boundaries of closing time
- reorder keeping modifiers, notes and reward eligibility
- special instructions reaching the kitchen ticket
- tax **not** being sent to Clover
- WCAG contrast, recomputed from `styles.css` rather than asserted by eye
- the private token never reaching the bundle
- the print URL, character for character, including no `/orders/` in the path,
  no doubled slash, and the method and body that reach `fetch`
- printer selection, including a `MY_LOCAL`-only merchant and an unknown type
- the ticket carrying name, phone and window — and the order being refused
  without them
- prep being the maximum of a cart and not the sum, and an unknown item
  falling back to 30 minutes
- no shipped file emitting the string "ASAP", checked by scanning the source
- search matching modifier text, ignoring oos options, ranking exact names
  first, and the generated index still matching what the generator would emit
- points NOT awarded on order creation, awarded on confirmed payment, awarded
  exactly once across a relaunch, and never for a voided order
- polling stopping the moment the answer is final
- `PREP_MINUTES` in the generator and `prepMinutes` in the generated data
  still agreeing, so a regeneration cannot silently drop them

Run `npm test` before committing. The suite is deterministic — if it's flaky,
that's a bug worth fixing, not retrying.
