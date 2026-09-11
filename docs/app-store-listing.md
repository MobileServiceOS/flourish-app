# App Store Connect — Flourish BX

Ready-to-paste fields for submission. Identifiers match `capacitor.config.ts`
(`appId: com.flourishbx.order`, `appName: Flourish BX`) so nothing needs
reconciling by hand.

**Last checked against the app on 2026-09-08.** Four things in the previous
version had gone stale and would have been wrong in the store — see *What
changed* at the end. Metadata that describes food you do not sell, or a payment
flow the app no longer has, is both an App Review rejection and a customer
complaint.

---

## Identity

| Field | Value |
|---|---|
| **App Name** | Flourish BX |
| **Subtitle** | Pickup ordering, no markup |
| **Bundle ID** | `com.flourishbx.order` |
| **Primary Category** | Food & Drink |
| **Secondary Category** | *(leave blank)* |
| **Age Rating** | 4+ — no objectionable content |
| **Copyright** | © 2026 Flourish bx inc |
| **Support URL** | https://mobileserviceos.github.io/flourish-app/support.html |
| **Privacy Policy URL** | https://mobileserviceos.github.io/flourish-app/privacy.html |
| **Marketing URL** | *(optional)* https://flourishbx.com |

> **Subtitle length.** 26 characters; Apple's limit is 30. The original
> "Pickup ordering — no fees, no markup" was 36 and would have been rejected.
> If discovery matters more than phrasing, **"Caribbean pickup, no fees"** (25)
> adds the cuisine, which nothing else in the identity block covers.

> **The URLs must resolve before you submit.** They point at the
> `MobileServiceOS` GitHub Pages site. A dead privacy or support URL is one of
> the most common rejections there is. Open both in a browser first.

---

## Description

*(2395 characters — the limit is 4,000)*

```
Real Caribbean food from Flourish, on Laconia Ave in the Bronx. Order ahead, skip
the line, and pick it up when it's ready.

NO FEES, NO MARKUP

Delivery apps take a cut of every order and raise the menu price on top of it.
Order here and you pay what we charge at the counter. Nothing added. On a plate
of oxtail that difference is a few dollars, every single time.

The app shows you what you're saving on each item, so you can check it yourself.

THE WHOLE MENU

Everything the kitchen makes, priced exactly as it rings up on our register:
oxtail, curry goat, jerk chicken, brown stew chicken, fried chicken, wings by
the sauce, salmon six ways, shrimp, lamb, pork ribs, stew peas, snapper, and
plates that come with two sides.

Pick your size, pick your flavour, pick your sides, and tell the kitchen how you
want it - "no pepper", "extra gravy". Special instructions go straight onto the
ticket. Want a side on its own? Order it on its own.

SEARCH THE WAY YOU TALK

Look for "sweet chili salmon", "fried shrimp" or "escovitch" and you get the
dish, already set to the flavour you asked for.

SEAFOOD FRIDAYS

Crab legs, lobster and shrimp platters, cooked on Fridays only. The app puts
them at the top of the menu on the day and tells you when they're back the rest
of the week.

READY WHEN WE SAY IT WILL BE

Every order gets a real pickup window, worked out from what you ordered. Fish,
seafood and lamb are cooked to order and take longer than a plate off the steam
table, and the app says so instead of promising everyone the same fifteen
minutes. Or schedule it for later in the day. The app knows our hours, and it
will not sell you a time the kitchen cannot cook by.

PAY AT THE COUNTER

No card needed to order. Your order goes to the kitchen and you pay when you
collect it, by card or cash. The app never asks for card details and never
takes a payment.

REWARDS THAT ARE ACTUALLY WORTH SOMETHING

Earn a point for every dollar once you have paid. Turn them into a free drink, a
free side, loaded seafood mac and cheese, or a free plate. Points don't expire.
Signing up takes a name and a phone number - no email, no password, no card on
file.

REORDER IN ONE TAP

Your usual is on the Orders tab, sides and instructions included. One tap puts
the whole thing back in the cart.

PICKUP ONLY

4035 Laconia Ave, Bronx, NY 10466
Open 11AM to 10PM, until 11PM on Friday and Saturday.
```

---

## Keywords

*(100 characters — the limit is exactly 100, commas included)*

```
jamaican,caribbean,oxtail,jerk chicken,soul food,bronx,curry goat,takeout,order ahead,rewards,shrimp
```

No spaces after the commas: spaces count against the 100.

**`patty` was removed.** Both patties are in `DELISTED` in
`scripts/generate-menu.mjs` — the kitchen stopped making them — so the word was
advertising food that is not on the menu. `shrimp` took the freed characters: it
is on the menu twice, it is a Seafood Friday platter, and it is something people
search for.

---

## App Privacy — the App Store Connect questionnaire

Answers must match `docs/privacy.html`, or review flags the mismatch.

**Data used to track you:** None.
**Data linked to you:** Contact info (name, phone number); Purchases (order
history); Other data (loyalty points balance).
**Data not linked to you:** None.

All of the below are **linked to identity**, used for **App Functionality**
only, and **not used for tracking**:

| Data type in App Store Connect | Collected | What it is actually for |
|---|---|---|
| **Name** | Yes | Printed on the kitchen ticket so staff can hand the right bag to the right person |
| **Phone Number** | Yes | Printed on the ticket so staff can call about the order, and used to look up a loyalty account |
| **Purchase History** | Yes | The Orders tab, one-tap reorder, and loyalty points |
| **Other Data** (points balance) | Yes | The loyalty programme |

Answer **No** to: Location, Contacts, Photos or Videos, Health & Fitness,
Browsing History, Search History, Identifiers, Usage Data, Diagnostics,
Financial Info, Sensitive Info, User Content, Audio Data, Customer Support,
Emails or Text Messages, Gameplay Content, Other Financial Info.

> **Financial Info is "No", and it is now unambiguous.** The app takes no
> payment at all. Orders are sent to the register unpaid and the customer pays
> at the counter. There is no card form anywhere in the app, no payment SDK on
> the checkout screen, and no card number ever reaches this code.

> **Phone Number is not used to message anyone.** The app sends no messages of
> any kind. There is no Twilio account and no messaging integration, and a test
> fails the build if wording promising one reappears anywhere a customer can
> read it — including in this file. Order-ready alerts are **local
> notifications scheduled on the device** — they never leave the phone, so they
> are not a data collection at all. Do not tick "Emails or Text Messages".

**Account deletion.** Apple guideline 5.1.1(v) requires an app that supports
account creation to let you delete the account from inside the app. Flourish
does: **Rewards tab → Delete account**, with a confirmation step that names
exactly what goes.

Deleting removes, from the device: the saved name and phone number, the in-app
order history, and the points balance including any unredeemed rewards. The
confirmation says plainly that unspent points are forfeited and cannot be
restored.

It does **not** delete the restaurant's own records. Orders already sent to the
register are the shop's receipts for food it cooked and sold — its bookkeeping
and tax records — and a customer deleting their app account does not reach into
those. The confirmation copy explains that distinction, because "delete my
account" reasonably sounds like it might.

Deletion is entirely local and makes no network call, so it works with the
proxy unreachable, the shop shut, or the phone offline.

---

## Review notes (paste into "Notes for Review")

```
Flourish BX is the ordering app for a single restaurant, Flourish bx inc, at
4035 Laconia Ave, Bronx NY 10466. Pickup only. There is no delivery.

NO PAYMENT IS TAKEN IN THE APP. An order is sent to the restaurant's Clover
register unpaid and the customer pays at the counter when they collect. There
is no card form, no payment SDK and no in-app purchase anywhere in the app, so
there is nothing to test on that front.

No login is required to browse the menu or place an order. An optional account
(name and phone number, no password, no email) enables loyalty points. To test
it, tap the "Sign in" tab and enter any name and any 10-digit US phone number.
No verification code is sent.

Loyalty points are awarded only after the restaurant confirms payment at the
register, so a test order will not show points until it is paid for in store.

The app enforces the restaurant's opening hours (11AM-10PM, until 11PM Friday
and Saturday, New York time) and will not accept an order it cannot cook before
closing. If you are testing outside those hours the checkout will say so; that
is intended behaviour, not a fault.

Account deletion is in the app: Rewards tab, "Delete account", with a
confirmation step. It removes the account, the order history and the points
balance from the device immediately and works offline. It deliberately does not
delete the restaurant's own transaction records for orders already placed,
which are its receipts and tax records; the confirmation explains this to the
user before they confirm.
```

---

## Screenshots

Apple requires **one** iPhone size; a second is optional and looks better on
larger devices. Take them on the phone, portrait.

| Display size | Pixels (portrait) | Device to shoot on | Required |
|---|---|---|---|
| **6.9" / 6.7"** | **1290 × 2796** | iPhone 15/16 Pro Max, 14 Pro Max | **Yes — this one alone is enough** |
| 6.5" | 1242 × 2688 | iPhone 11 Pro Max, XS Max | Optional |
| 5.5" | 1242 × 2208 | iPhone 8 Plus | Only for old-device support |
| iPad 12.9" | 2048 × 2732 | iPad Pro | Only if submitted as universal |

Between 3 and 10 per size. Upload them in this order — the first two are what
most people ever see.

**1. Menu.** Scrolled to the top: logo, "Pickup only · no delivery", the rating
and hours row, the Popular section, and the first Lunch & Dinner rows with their
prices and a green SAVE badge visible. This is the shop front.

**2. Item sheet.** Open Salmon. Show the flavour list, both side pickers, and
the "Cooked to order · about 30 min" chip. It proves the app is a real ordering
tool, not a menu PDF.

**3. Cart.** Two or three lines including one with a special instruction, a
reward applied so the green discount row shows, the "You're saving $X ordering
direct" panel, and the live ready window.

**4. Checkout.** Name and phone filled in, the pickup window showing a real
time, the tip row, the totals with tax, and the **PAY AT PICKUP** panel clearly
visible. That panel answers the "how do I pay?" question before anyone asks it.

**5. Confirmation.** An order number, the ready window, the three-step live
status, and the "Your ticket printed in the kitchen" line.

Practical notes: use a real order, not lorem — Apple rejects placeholder
content. Take them in daylight hours so the shop is open and nothing shows the
closed state. Turn off Do Not Disturb so no banner covers the status bar. A full
battery and clean status bar look deliberate.

---

## Pre-flight checklist

Things Apple actually rejects for, that apply to this app.

**Blocking — the app will be rejected**

- [ ] **The proxy is deployed and reachable.** With it down, every reviewer sees
      "ordering not available right now" and the app is rejected as
      non-functional. This is the single most likely rejection.
- [ ] The build points at the hosted proxy, not localhost. `npm run release:ios`
      refuses to build otherwise.
- [ ] Privacy Policy URL and Support URL both load in a browser.
- [ ] App privacy answers match `docs/privacy.html`.
- [ ] Icon is 1024×1024, **no alpha channel**, no rounded corners. `npm run
      icons` strips alpha and a test asserts it.
- [ ] Screenshots show the real app, no placeholder content, no device frames.
- [ ] Nothing in the metadata mentions food that is not on the menu.
- [ ] Signing certificate and provisioning profile exist for
      `com.flourishbx.order`, and the Apple Developer Program membership is
      active.

**Likely to be questioned**

- [x] **Account deletion.** In the app, Rewards tab, with confirmation.
      Satisfies 5.1.1(v). Was by phone call, which is not compliant.
- [ ] **"Pay at pickup" is not an in-app purchase.** It is physical goods
      collected in person, which is explicitly outside Apple's IAP rules. The
      review note says so plainly.
- [ ] **Minimum functionality.** A single-restaurant ordering app is fine;
      ordering, loyalty, live status and reorder are well past "repackaged
      website".
- [ ] **Opening hours.** A reviewer testing at 3am sees the closed state. The
      review note explains it.

**Worth doing anyway**

- [ ] Version and build number set (see below).
- [ ] Test on a real device, not just the simulator — the splash and the app
      icon have both broken on hardware before and looked fine in a browser.
- [ ] Place one real order end to end and watch the ticket print.
- [ ] Check the app with the proxy switched off: it must degrade to preview
      mode, not hang or crash.

---

## Version and build number

| Where | Field | Now | For submission |
|---|---|---|---|
| `package.json` | `version` | 1.0.0 | 1.0.0 |
| Xcode → App → General | Version (`MARKETING_VERSION`) | 1.0.0 | stamped automatically |
| Xcode → App → General | Build (`CURRENT_PROJECT_VERSION`) | 1 | bump per upload |

**`package.json` is authoritative.** `ios/` is gitignored and regenerated by
`npx cap add ios`, so a version typed into Xcode is lost the next time the
platform is rebuilt — which is how the two came to disagree (1.0.0 against 1.0).
`npm run sync` now runs `npm run native:stamp` after `cap sync`, writing
`MARKETING_VERSION` from `package.json`, next to the icons which are restored
for the same reason. To release 1.1.0, change `package.json` and sync.

The **build number** is not stamped: it must increase on every upload to App
Store Connect even when the version does not, so it belongs to whoever is
uploading. Bump it in Xcode or with `agvtool next-version -all`.

---

## What changed in this revision, and why

The previous version predated sides, search, per-item prep times, loyalty and
pay-at-pickup. Four things in it were **wrong**, not merely dated:

1. **It advertised patties.** Both are in `DELISTED` — the kitchen stopped
   making them — so the description and the `patty` keyword pointed at food that
   cannot be ordered.
2. **It described card payments through a Clover hosted form.** The app takes no
   payment at all now. The review notes told Apple to test a flow that does not
   exist, which is a fast way to a rejection and a confused reviewer.
3. **It promised "most orders take 15 to 25 minutes".** Prep is per item now —
   fifteen off the steam table, thirty for anything cooked to order — and every
   order is quoted a real window. A flat range under-promises for chicken and
   over-promises for salmon.
4. **It said the phone number was used for an "order-ready notification".** The
   app sends no messages at all. Notifications are local to the device. Left
   uncorrected,
   the privacy label would have claimed a data use that does not happen.

Added: sides sold on their own, flavour search, the pickup window, pay at
pickup, and points being earned at the register rather than at checkout.
