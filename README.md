# Flourish BX — Pickup Ordering App

Commission-free pickup ordering for **Flourish bx inc**, 4035 Laconia Ave, Bronx NY 10466.

Pickup only. No delivery, no service fees, no platform cut.

---

## Open it in VS Code

```bash
cd ~/Projects            # or wherever you keep code — not Downloads
# put this folder here, then:
code flourish-app
```

Then, in the VS Code terminal (**Terminal → New Terminal**, or `` Ctrl+` ``):

```bash
npm install
npm run dev
```

Open the URL it prints (usually `http://localhost:5173`). Edit any file and the
browser updates instantly.

**To try it on your actual phone** while it's running: the terminal also prints a
`Network:` address like `http://192.168.1.x:5173`. Open that on your phone —
same wifi, no build needed. This is the fastest way to check how it really feels.

### Recommended VS Code extensions
- **ESLint** — catches mistakes as you type
- **Prettier** — formatting
- **ES7+ React snippets** — shortcuts for React

---

## Project layout

```
flourish-app/
├─ index.html                  page shell, share-preview meta, font preloads
├─ brand/
│  └─ logo.png                 full-resolution master (5000x5000) — not shipped
├─ public/
│  ├─ logo-512.png             splash + header
│  ├─ logo-1024.png            App Store icon, no alpha
│  ├─ logo-192.png             web manifest
│  ├─ icons/                   favicon, apple-touch-icon, PWA — npm run icons
│  └─ og-image.jpg             the share-preview image, served from our domain
├─ package.json                dependencies and commands
├─ vite.config.js              dev server + build + test config
├─ capacitor.config.ts         native app id and name
├─ server/                     Clover proxy — holds the private token
│  ├─ index.js                 entry point
│  ├─ app.js                   routes
│  ├─ clover.js                API client
│  └─ env.js                   config, never logs a secret
├─ docs/                       published to GitHub Pages, no build step
│  ├─ privacy.html             Privacy Policy URL for App Store Connect
│  ├─ support.html             Support URL for App Store Connect
│  └─ app-store-listing.md     ready-to-paste submission fields
├─ .github/workflows/
│  └─ pages.yml                deploys docs/ on push to main
├─ scripts/
│  └─ generate-menu.mjs        Clover export -> menu data
└─ src/
   ├─ main.jsx                 mounts React
   ├─ App.jsx                  state owner and router — nothing else
   ├─ styles.css               full stylesheet
   ├─ components/
   │  ├─ Splash.jsx            launch screen — logo framed by blooming petals
   │  ├─ MenuView.jsx          menu, search, category chips
   │  ├─ ItemSheet.jsx         size / flavor / sides / special instructions
   │  ├─ CartView.jsx          lines, rewards, totals
   │  ├─ CheckoutView.jsx      details, pickup time, tip, pay
   │  ├─ TrackView.jsx         order confirmation and live status
   │  ├─ RewardsView.jsx       points, redemption, account, share
   │  ├─ SignInView.jsx        join Flourish Rewards
   │  ├─ OrdersView.jsx        history and one-tap reorder
   │  ├─ StaffSheet.jsx        86 control
   │  └─ shared.jsx            SubHeader, Section, Group, Option, Empty,
   │                           Hummingbird, Thumb, Splash, useSheet
   ├─ data/
   │  └─ menu.data.js          GENERATED — never hand-edit
   ├─ hooks/
   │  └─ clover.js             health, inventory sync, order polling
   ├─ lib/
   │  ├─ clover.js             browser API client (no secrets)
   │  ├─ cloverOrder.js        cart -> Clover order, pure and tested
   │  ├─ money.js              cent-accurate rounding
   │  ├─ loyalty.js            tiers, rewards, discount rules
   │  ├─ hours.js              opening hours and pickup slots
   │  ├─ phone.js              phone formatting and validation
   │  ├─ restaurant.js         address, phone, Popular, day helpers
   │  ├─ share.js              native share sheet + clipboard fallback
   │  └─ storage.js            account persistence
   └─ test/                    Vitest + Testing Library
```

## Tests

```bash
npm test          # once
npm run test:watch
```

259 tests. They cover the things that cost money if they break: pickup-slot
boundaries around closing time, reorder keeping its modifiers and notes,
special instructions reaching the kitchen ticket, and a WCAG contrast check
that recomputes every text colour pairing straight out of `styles.css`. On the
Clover side they cover order payload construction, reward discounts, tax being
left to Clover, modifier mapping, and every error state including a declined
card and a proxy that isn't running.

---

## Updating the menu

**Never edit prices by hand.** Clover is the register — whatever it says is what
the customer is charged. Export and regenerate instead:

1. Clover Dashboard → **Items** → **Export** (downloads an `.xlsx`)
2. ```bash
   npm run menu -- ~/Downloads/inventory-export.xlsx
   ```

That rewrites `src/data/menu.data.js` with live Clover item and modifier-group ids,
so every order maps 1:1 onto the register.

**Prices come from the printed menu, not from Clover.** Where the two disagree the
menu wins, via the `MENU_PRICE` / `ITEM_MENU_PRICE` / `NOT_ON_PRINTED_MENU` maps in
that script. Clover still charges what Clover says, so those changes have to be
entered in the Clover dashboard too — the script prints the list every run, and
`PRINTED-MENU-PRICES.md` has it written out.

Clover's export carries no description field, so the one-line menu copy lives in
the `DESC` map at the top of `scripts/generate-menu.mjs`, keyed by Clover item id.
Same for `POPULAR_IDS` (the six on the website's "What We're Known For") and
`CATEGORY_DAYS` (which locks Seafood Fridays to Friday). **Edit those there, not
in `menu.data.js`** — anything hand-written into the generated file is lost the
next time you regenerate. Adding an item in Clover without adding a description
just means a bare row; the script prints a list of anything it couldn't describe.

The script also **refuses to ship pricing that would charge a customer wrongly**.
It prints a report of anything mispriced in Clover — a $0 modifier that would ring
up free, an item that double-charges, an add-on filed as a size. Those are hidden
in the app and listed for you to fix at the source. See `CLOVER-FIXES.md`.

---

## Brand assets

The logo master lives in `brand/logo.png`. Everything the app loads is derived
from it — run `npm run icons` after replacing it. See `brand/README.md`.

Apple rejects an app icon with an alpha channel, so the derived icons are
composited onto the paper colour first and the generator fails loudly if any
still has one.

## Item photos

Most rows show the emoji tile — that's a design choice, not a missing asset.
To give an item a real photo, drop the file in `public/items/` and add an `img`
path to that item in the `DESC`-style maps in `scripts/generate-menu.mjs`:

```js
img: "/items/oxtail.jpg"
```

Keep them square and around 600×600. If the file is missing the row falls back
to the emoji rather than showing a broken image.

**Serve everything from our own domain.** Nothing the customer loads should come
from a delivery platform's CDN — that is a dependency on a competitor staying up,
and their image ids don't line up with Clover's anyway. A test fails the build if
a `cdn4dd.com` or `doordash-static` URL reappears in the source.

## Public pages and App Store submission

`docs/` is published to GitHub Pages on every push to `main`. It is plain HTML
with no build step, so a broken app build can never take the legal pages offline
— which matters, because these two URLs are what Apple's reviewers open:

| Page | URL |
|---|---|
| Privacy Policy | https://mobileserviceos.github.io/flourish-app/privacy.html |
| Support & FAQ | https://mobileserviceos.github.io/flourish-app/support.html |

Editing either page and pushing to `main` redeploys it within about a minute.
The workflow fails deliberately if either file is missing or empty, rather than
publishing a site with a dead legal URL.

`docs/app-store-listing.md` holds every App Store Connect field ready to paste —
name, subtitle, description, keywords, the App Privacy questionnaire answers,
and notes for App Review. The remaining blockers for submission are the app
icon and screenshots, which are listed at the bottom of that file.

> If this repo ever moves to a different GitHub account or a custom domain, the
> two URLs above change. Update them in App Store Connect at the same time — a
> dead privacy or support URL is a routine rejection.

## Building the native app

```bash
npm install
npx cap add ios          # once
npm run ios              # build + sync + open Xcode
```

Android is the same with `npx cap add android` and `npm run android`.

You'll need Xcode and an Apple Developer account to put it on the App Store.

---

## What works right now

- Full menu from Clover — 31 items across Lunch & Dinner, Seafood Fridays, Drinks,
  each with a one-line description. Prices follow the printed menu
- Rows where the two prices are just the two sizes read "Med $20 · Lg $25"
  rather than a bare range
- A **Popular** section up top showing the six the shop is known for — the same
  item objects the categories use, not copies
- Sizes, flavors, and two included sides, priced exactly as Clover prices them
- Category chips that smooth-scroll, and highlight as you scroll past sections
- Cart, checkout, tip, tax, order confirmation and live status
- **Pickup times** on a 15-minute grid up to close (10PM, seven days a week),
  with ASAP as the default and a proper "we're closed" state outside hours
- **Seafood Fridays** leads the menu on Fridays and is marked "(Fri)" otherwise
- One-tap **reorder** that restores modifiers, notes and reward eligibility, and
  tells you if anything on the old order is sold out today
- Special instructions per item, carried through to the cart, the confirmation
  and the order history
- Customer accounts with points that persist across launches
- Reward redemption that applies a real discount to the cart
- Savings badges showing what ordering direct beats Uber Eats by
- Staff 86 control — tap the lock icon on the menu to mark items sold out

Accessibility: every control has an accessible name, the sheets are real modal
dialogs (Escape closes, focus is trapped and restored), items can be added from
the keyboard, and every text colour clears WCAG AA — checked by a test, not by eye.

## Clover integration

Orders, payments, inventory and customers are wired to Clover through a small
proxy server. Run both halves:

```bash
npm run dev:all      # frontend on 5173 + proxy on 3001
```

or separately with `npm run dev` and `npm run server`.

**The frontend alone still works.** With no proxy running the app is in *preview
mode*: browsing, search and the cart all work, and the checkout says so instead
of failing. That's a tested state, not an accident.

### Why there's a server

`CLOVER_PRIVATE_TOKEN` can create orders and charge cards. Vite inlines every
`VITE_*` variable into the browser bundle, so that token deliberately has **no**
`VITE_` prefix and never leaves the server. The browser only gets the public
token, which can tokenize a card but not charge one — and card numbers go
straight from Clover's hosted iframes to Clover without passing through our code.

### Credentials

From the Clover Dashboard (gear icon → View all settings):

1. **Business Operations → API tokens** — Read/Write on Orders, Inventory,
   Customers, Merchant, Payments
2. **Ecommerce → Ecommerce API Tokens** — type "Hosted iFrame + API/SDK"
3. **Merchant ID** — About Your Business → Merchants

Both token pages require two-factor auth enabled and location access allowed.

Put them in `.env.local` (gitignored — never commit these):

```
VITE_CLOVER_MERCHANT_ID=
VITE_CLOVER_PUBLIC_TOKEN=
CLOVER_PRIVATE_TOKEN=
CLOVER_API_BASE=https://apisandbox.dev.clover.com
```

### Switching sandbox → production

Change one line in `.env.local` and restart the server:

```
CLOVER_API_BASE=https://api.clover.com
CLOVER_ALLOW_PRODUCTION=yes
```

The second line is a deliberate guard: the server **refuses to start** against a
non-sandbox host without it, so a stray edit can't quietly start billing real
cards. While the base contains `sandbox`, a red **SANDBOX** badge shows in the
app header; it disappears on its own in production.

> **Heads up:** the credentials currently in `.env.local` return `401
> Unauthorized` on every Clover endpoint, so the integration is built and
> unit-tested but has never been confirmed against a live merchant. Regenerate
> them in the sandbox dashboard. See `ROADMAP.md`.

### Deploying

The proxy has to be hosted somewhere — Railway, Fly.io or a Firebase Cloud
Function all work. It needs `CLOVER_PRIVATE_TOKEN` set as a secret, and the app's
`/api` calls pointed at it.

Set these before deploying, or the proxy refuses every remote caller:

```
APP_KEY=<any long random string>
ALLOWED_ORIGINS=https://flourishbx.com
MAX_CHARGE_DOLLARS=500
```

`VITE_APP_KEY` must match `APP_KEY`. It ships in the browser bundle and is not a
secret — it turns away scanners. The real protection is the rate limit, the
origin allowlist and the charge ceiling, plus the fact that
`CLOVER_PRIVATE_TOKEN` never leaves the server.
