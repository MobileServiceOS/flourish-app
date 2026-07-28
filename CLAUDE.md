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

### Sales tax

`TAX_RATE` in `src/lib/money.js` is **8.5%**, and that constant is the only
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

For reference, the combined New York City rate on prepared food is 8.875%
(4% state + 4.5% city + 0.375% MCTD). 8.5% was set deliberately on request; if
that turns out to be wrong the difference is owed at filing time.

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
npm test            # 243 tests
```

Preview mode is a real, tested state: if the proxy isn't running the app still
browses, searches and builds a cart, and the checkout says *"App is in preview
mode — ordering is not connected yet"* rather than throwing.

## Known blockers

**The credentials in `.env.local` return 401.** Every endpoint, both hosts, both
tokens, and unauthenticated all return `401 Unauthorized`, so the sandbox is
reachable but the tokens are rejected at auth. Everything downstream of a live
call is therefore built and unit-tested but **not verified against real Clover**.
Regenerate the tokens in the Clover sandbox dashboard (Business Operations → API
tokens, needs 2FA enabled) and re-run `npm run server`.

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

Run `npm test` before committing. The suite is deterministic — if it's flaky,
that's a bug worth fixing, not retrying.
