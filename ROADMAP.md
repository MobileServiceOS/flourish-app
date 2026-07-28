# Roadmap

Status of the Flourish BX pickup app. Ticked items are built **and covered by
tests**; anything needing live Clover credentials is called out explicitly,
because the sandbox tokens currently in `.env.local` return 401.

---

## Shipped

### Ordering basics
- [x] Full menu generated from the Clover inventory export (42 items)
- [x] Sizes, flavors and two included sides, priced exactly as Clover prices them
- [x] Cart, quantities, per-item special instructions
- [x] Customer accounts persisted across launches
- [x] Points, tiers and reward redemption applying a real cart discount
- [x] Savings badges vs Uber Eats
- [x] Staff 86 control

### UX polish
- [x] One-line description on every menu row, regen-safe in the generator
- [x] Popular section — the six "known for" items, referencing the same objects
- [x] Smooth-scrolling category chips with scroll-spy highlighting
- [x] Prominent red cart badge
- [x] Order confirmation: ready time, itemised order, address, phone, maps, call
- [x] Add-to-cart confirmation animation

### Business features
- [x] One-tap reorder preserving modifiers, notes and reward eligibility
- [x] Seafood Friday promotion — leads the menu Fridays, "(Fri)" otherwise
- [x] Pickup time picker on a 15-minute grid, with a real closed state
- [x] Share Flourish via the native share sheet
- [x] Special instructions carried through to cart, confirmation and history
- [x] Order-ready notification, scheduled on the device at the estimated ready
      time. No server, no device tokens, nothing to pay per message. Permission
      is asked on the confirmation screen, where the reason is obvious, and a
      refusal is handled without nagging.

### Production readiness
- [x] Empty states for cart, orders and search
- [x] Branded launch screen — no sign-in flash for returning customers
- [x] Live phone formatting and input validation
- [x] Accessibility: names on every control, modal dialogs, keyboard operation
- [x] WCAG AA contrast, verified by a test that recomputes from the stylesheet
- [x] Share-preview meta tags, self-hosted image
- [x] `App.jsx` split into nine screens plus shared pieces
- [x] Test suite — there was none before

### Clover integration
- [x] Server proxy holding the private token (`server/`)
- [x] Client API layer that degrades to preview mode (`src/lib/clover.js`)
- [x] Atomic order construction, unit-tested (`src/lib/cloverOrder.js`)
- [x] Rewards as order-level discounts
- [x] Tax left to Clover; tip on the payment, not the order
- [x] Print event fired, non-fatal when the printer is down
- [x] Hosted-iframe card tokenization + "Pay at pickup" alternative
- [x] Inventory-driven sold-out sync, manual 86 as an override, push-back to Clover
- [x] Real order status polling, replacing the simulated timers
- [x] Customer sync to Clover with lookup by phone
- [x] Error handling: network, decline, unresolved modifier, proxy down
- [x] SANDBOX badge driven by `CLOVER_API_BASE`
- [x] Server refuses to boot against production without an explicit opt-in

---

## Blocked

- [ ] **Verify the integration against live Clover.** Built and unit-tested, but
      never exercised against a real merchant: the tokens in `.env.local` return
      401 on every endpoint and both hosts. Needs fresh sandbox credentials from
      the Clover dashboard. Until then no order, charge, print or inventory call
      has been confirmed end to end.
- [ ] **Ring-test the five pricing bugs in `CLOVER-FIXES.md`.** Baked Chicken
      double-charges; goat soup rings up free; a $1.50 add-on sits in the Wings
      size group; pork prices disagree with the printed menu; seafood stew peas is
      filed as a size of regular stew peas. The app works around all five, but
      they still mis-ring at the counter.

## Next

- [ ] Photos for the six Popular items — every row currently shows its emoji
      tile. Drop files in `public/items/` and add `img` paths.
- [ ] Host the proxy. Railway, Fly.io or a Firebase Cloud Function; it needs
      `CLOVER_PRIVATE_TOKEN` as a secret and the app needs `/api` pointed at it.
- [ ] **Authenticate the proxy before it goes public.** It is currently open —
      fine on localhost, not fine on the internet, where anyone could POST to
      `/api/clover/pay`. Needs at minimum an app-level shared secret and rate
      limiting.
- [ ] Server-sent push the moment Clover flips the order to ready, replacing the
      scheduled local notification. Needs an Apple Developer account, an APNs
      key, and somewhere to keep device tokens — the proxy is stateless today.

## Not planned

- **Delivery.** The entire point is that ordering direct avoids the platforms.
- **Catering.** 62 catering items sit in the same Clover inventory, all $0 and priced
  by quote. It is not a pickup flow and stays a phone call. The generator skips any
  item with "(Catering" in its name so they never reach customers — leave that filter
  in place.
- **SMS.** Order-ready alerts are notifications, not texts. Push costs nothing to
  send; Twilio is about $0.008 a message, forever.
