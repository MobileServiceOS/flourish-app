# App Store Connect — Flourish BX

Ready-to-paste fields for submission. Everything here matches
`capacitor.config.ts` (`appId: com.flourishbx.order`, `appName: Flourish BX`),
so the identifiers do not need to be reconciled by hand.

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

> **Note on the subtitle.** The original wording, "Pickup ordering — no fees, no
> markup", is 36 characters and Apple's subtitle limit is 30, so it would have
> been rejected. Shortened to "Pickup ordering, no markup" (26). If discovery
> matters more than the exact phrasing, **"Caribbean pickup, no fees"** (25) is
> a stronger alternative — Apple indexes the subtitle for search, and it adds
> the cuisine, which nothing else in the identity block covers.

> **Note on the URLs.** These point at the `MobileServiceOS` GitHub account,
> which is the account this repository was created under. If the repo later
> moves to a different account or a custom domain, update these two URLs in App
> Store Connect at the same time — a dead privacy or support URL is a routine
> App Review rejection.

---

## Description

*(1,783 characters — the limit is 4,000)*

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
the sauce, salmon six ways, shrimp, lamb, pork ribs, stew peas, patties, and
plates that come with two sides.

Pick your size, pick your sides, and tell the kitchen how you want it — "no
pepper", "extra gravy". Special instructions go straight onto the ticket.

SEAFOOD FRIDAYS

Crab legs, lobster and shrimp platters, cooked on Fridays only. The app puts
them at the top of the menu on the day and tells you when they're back the rest
of the week.

ORDER WHEN IT SUITS YOU

Pick it up as soon as it's ready — most orders take 15 to 25 minutes — or
schedule it for later in the day. The app
knows our hours, so it will not sell you a time we're closed.

REWARDS THAT ARE ACTUALLY WORTH SOMETHING

Earn a point for every dollar. Turn them into a free drink, a free side, loaded
seafood mac and cheese, or a free plate. Points don't expire. Signing up takes a
name and a phone number — no email, no password, no card on file.

REORDER IN ONE TAP

Your usual is on the Orders tab, sides and instructions included. One tap puts
the whole thing back in the cart.

PICKUP ONLY

4035 Laconia Ave, Bronx, NY 10466
Open 11AM to 10PM, until 11PM on Friday and Saturday.

The app tells you when your food is ready.
```

---

## Keywords

*(99 characters — the limit is 100, commas included)*

```
jamaican,caribbean,oxtail,jerk chicken,soul food,bronx,curry goat,takeout,order ahead,rewards,patty
```

**What changed from the original list and why.** The list as first drafted came
to 110 characters, over Apple's 100-character limit, so it would have been
truncated mid-word. Adjustments:

- `pickup` and `no delivery fee` removed — "pickup" already appears in the
  subtitle and app name, which Apple indexes separately, so spending 7
  characters repeating it is wasted. `no delivery fee` cost 16 characters for a
  phrase nobody searches; the description carries that message instead.
- `jamaican food` → `jamaican`, `loyalty rewards` → `rewards` — Apple matches
  across the whole keyword set, so the generic halves were redundant.
- `curry goat`, `takeout` and `patty` added with the characters freed up. All
  three are dishes and phrasings people actually search for.

Do not add spaces after the commas. Spaces count against the 100.

---

## App Privacy (the questionnaire in App Store Connect)

Answers here must match `docs/privacy.html` exactly, or review will flag the
mismatch.

**Data used to track you:** None.
**Data linked to you:** Contact info (name, phone number); Purchases (order
history); Other data (loyalty points balance).
**Data not linked to you:** None.

Per data type — all **linked to identity**, all used for **App Functionality**
only, and **not used for tracking**:

| Data | Collected | Purpose |
|---|---|---|
| Name | Yes | Matching the order to the customer at the counter |
| Phone Number | Yes | Order-ready notification and loyalty lookup |
| Purchase History | Yes | Reorder, and loyalty points |
| Other Data (points balance) | Yes | Loyalty programme |

Answer **No** to: Location, Contacts, Photos or Videos, Health & Fitness,
Browsing History, Search History, Identifiers, Usage Data, Diagnostics,
Financial Info, Sensitive Info, User Content.

> **Financial Info is "No" deliberately.** Card details are entered into
> Clover's hosted form and go straight to Clover. The app never receives, sees
> or stores a card number — only a success confirmation.

**Account deletion:** Apple requires apps with account creation to offer
deletion. Flourish accounts are created from a name and phone number and are
deleted by calling the restaurant, which is documented in the privacy policy and
in the support FAQ. If review pushes back on this being off-app, the fallback is
an in-app "Delete my account" button on the Rewards tab.

---

## Review notes (paste into "Notes" for App Review)

```
Flourish BX is the ordering app for a single restaurant, Flourish bx inc, at
4035 Laconia Ave, Bronx NY 10466. Pickup only; there is no delivery.

No login is required to browse the menu or build an order. An optional account
(name and phone number only, no password) enables the loyalty points programme.

To test the loyalty features, tap the "Sign in" tab and enter any name and any
10-digit US phone number. No verification code is sent.

Card payments are processed by Clover, our point-of-sale provider, through their
hosted card form. The app never handles card numbers. "Pay at pickup" is offered
as an alternative and completes an order without any payment step, which is the
simplest path for review.

Account deletion is handled by calling the restaurant on (347) 859-9413, as
described in the privacy policy and the support page.
```

---

## Assets still needed

These cannot be generated from the codebase and are the remaining blockers for
submission:

- [ ] **App icon**, 1024×1024, no alpha channel, no rounded corners
- [ ] **iPhone screenshots** — 6.7" (1290×2796) and 6.5" (1242×2688) required.
      Good candidates: the menu with Popular at the top, an item sheet with
      sides selected, the cart with a reward applied, the order confirmation,
      the rewards screen.
- [ ] **iPad screenshots** — only if the app is submitted as universal
- [ ] Apple Developer Program membership, active
- [ ] A signing certificate and provisioning profile for `com.flourishbx.order`

Everything textual on this page is final and can be pasted as-is.
