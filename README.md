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
   │  ├─ RewardsView.jsx       Petals, redemption, account, share
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
   │  ├─ currency.js           what Petals are called, and the Perks disclaimer
   │  ├─ reconcile.js          which unpaid orders to re-check on launch
   │  ├─ hours.js              opening hours and pickup slots
   │  ├─ prep.js               per-item prep times and the ready window
   │  ├─ phone.js              phone formatting and validation
   │  ├─ restaurant.js         address, phone, Popular, day helpers
   │  ├─ share.js              native share sheet + clipboard fallback
   │  └─ storage.js            account persistence
   └─ test/                    Vitest + Testing Library
```

## Running the app

```bash
npm run dev:all      # frontend on 5180 + order proxy on 3001
```

Two halves. `npm run dev` alone gives you the menu, the cart, the account and
rewards, but the checkout button reads *"Ordering not available right now"* and
is disabled — placing an order needs the proxy, because that is what holds the
Clover credentials.

```bash
npm run dev          # frontend only
npm run server       # proxy only
curl localhost:3001/api/clover/health
```

### Testing on your phone

Same wifi, then open the **Network** URL Vite prints — `http://<your-ip>:5180`.

The port is pinned with `strictPort`, so if something else already holds 5180
Vite fails rather than quietly moving to another port. That matters: this
machine has other projects on 5173 and 5174, and a phone pointed at a port
another app had taken loads *that* app, whose `/api` is somebody else's server.
It looks exactly like "the proxy is broken".

## Tests

```bash
npm test          # once
npm run test:watch
```

817 tests. They cover the things that cost money if they break: pickup-slot
boundaries around closing time, reorder keeping its modifiers and notes,
special instructions reaching the kitchen ticket, and a WCAG contrast check
that recomputes every text colour pairing straight out of `styles.css`. On the
Clover side they cover order payload construction, reward discounts, tax being
left to Clover, modifier mapping, and every error state including a declined
card and a proxy that isn't running.

They also pin the four things that were found broken against the live register:
printer selection (a `MY_LOCAL` station is chosen, an unknown type is chosen, an
empty list is handled, retries and the 404 re-fetch fire, and a print failure
never loses the order); the kitchen ticket carrying a name, a phone and the
window, with the order refused outright when either is missing; per-item prep
times, including that a cart takes the maximum and not the sum, that sides and
drinks never push it out, that an unknown item falls back to 30 minutes rather
than 15, and that **no code path anywhere emits "ASAP"**; and the confirmation
screen following the real `printed` flag in both directions.

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
- **Search matches flavours, not just item names** — "sweet chili salmon",
  "escovitch" and "honey garlic" all find their dish, word order doesn't matter,
  and the options sheet opens on the flavour that was searched for. Sold-out
  options never match, and the two included sides every plate shares are not
  indexed — they are the same everywhere, so "mac and cheese" finds the side you
  can actually buy rather than twenty plates that come with one
- Cart, checkout, tip, tax, order confirmation and live status
- **Ready windows worked out per order.** Fish, seafood and lamb are cooked to
  order and take 30 minutes; everything else takes 15. A cart is quoted the
  slowest plate in it — never the sum — and sides and drinks never push it out.
  The window is a ten-minute range on a five-minute grid ("2:10–2:20 PM"),
  computed on the **server** and only displayed by the app
- **Pickup times** on a 15-minute grid from the earliest this cart could be
  ready, up to close, with a proper "we're closed" state outside hours
- The kitchen is asked whether it has time to **cook** the order, not just
  whether the door is open: a 30-minute plate at 9:50PM is refused with a reason
- **Seafood Fridays** leads the menu on Fridays and is marked "(Fri)" otherwise
- One-tap **reorder** that restores modifiers, notes and reward eligibility, and
  tells you if anything on the old order is sold out today
- Special instructions per item, carried through to the cart, the confirmation
  and the order history
- **Delete your account** from the Rewards tab, with a confirmation naming what
  goes: saved details, in-app order history, and the Petals balance including
  unredeemed rewards. Apple guideline 5.1.1(v) requires this in any app that
  supports account creation, and a phone number does not satisfy it. It is
  entirely local, so it works offline — and it deliberately leaves the
  restaurant's own order records alone, which the confirmation explains
- Customer accounts with **Petals** that persist across launches — named so they
  are never confused with the Clover Perks the shop runs at the register, which
  no API can read. Same maths either way: a Petal per dollar, 100 Petals = $5
  off, and the app says plainly that the two balances do not combine
- **Petals are earned at the register**, not when the order is placed: the app
  takes no money, so the tracking screen polls Clover every 30 seconds and
  credits them once the payment is confirmed. Close the app before paying and
  the next launch picks it up — the recent unpaid orders are re-checked when the
  app opens, which is the ordinary case and used to lose the Petals silently
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
npm run dev:all      # frontend on 5180 + proxy on 3001
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
CLOVER_PRINTER_UUID=ZVZ9PRJ255V90
```

`.env.example` has the full list with notes. `CLOVER_PRINTER_UUID` is optional —
see **Printing** below — but pinning it removes the guesswork.

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

### Printing

The kitchen ticket is what makes an order real to the staff, so this is worth
understanding.

On boot the server reads `GET /v3/merchants/{mId}/printers`, caches the list for
ten minutes, and picks one:

1. `CLOVER_PRINTER_UUID` if it names a printer that exists
2. otherwise the first printer of type `order`, then `kitchen`, `fiscal`,
   `receipt`, `MY_LOCAL`
3. **otherwise the first printer in the list, whatever its type**

Step 3 is the important one. This merchant has exactly one printer — the Clover
Station's built-in roll, which reports type `MY_LOCAL` — and it was missing from
the old selection list, so the server's print never fired at all. **Selection
never returns nothing while the merchant has any printer**, because a ticket on
the wrong roll is a nuisance and a ticket on no roll is an order the kitchen
never sees.

The ticket is POSTed to `{API_BASE}/v3/merchants/{mId}/print_event` — **merchant
scoped**, with the order named by `orderRef` in the body. Putting the order id in
the path instead gives `405 POST not allowed`, which is what Clover says for any
path it does not route, and is a failure that never mentions the path. The
startup banner prints the resolved URL on every boot for exactly that reason.

The chosen printer is named on the `print_event` itself. A print_event with no
printer is routed nowhere, which was also happening. A failure is retried once
after two seconds; a 404 means the printer is gone rather than busy, so the list
is re-read and the new choice tried instead.

Printing never fails an order — the order is on the register either way — but the
result is now reported honestly as `printed` and `printError`, and the
confirmation screen says what actually happened rather than guessing.

To see what the server chose:

```bash
curl localhost:3001/api/clover/printers      # the list, and which one is chosen
curl localhost:3001/api/clover/health        # printerConfigured / Name / Type
curl -X POST localhost:3001/api/clover/print-test   # reprint the last app order
```

`print-test` prints a real ticket on a real printer, so it respects `APP_KEY`
like every other endpoint. The startup banner also prints the chosen printer,
and says so loudly when Clover reports no printers at all.

### Deploying the proxy

**The app does not work without this.** Shipped to the App Store with no hosted
proxy, every customer opens it to *"ordering not available right now"* — the app
never crashes, it just quietly decides the kitchen is unreachable, and it does
that as convincingly in TestFlight as in the store.

**Host: Railway.** Chosen over Fly because this is one small always-on Node
process that needs environment variables managed by a non-engineer and nothing
else: Railway auto-detects Node with no Dockerfile, takes env vars in a
dashboard, redeploys on `git push`, and rolls back from a list of previous
deployments in two clicks. Fly's advantages — regions, machine sizing, scale to
zero — are things this workload does not want; scale-to-zero in particular would
add a cold start to the first order of the day. Nothing is Railway-specific
though: `Procfile` and `npm start` mean Fly, Render or Heroku work unchanged.

#### One-time setup

```bash
npm i -g @railway/cli      # or use npx @railway/cli
railway login              # opens a browser
railway init               # creates the project, from this directory
```

#### The environment variables

Set these in the Railway dashboard (**Variables**), or with
`railway variables --set 'KEY=value'`. **Never commit them** — `.env.local` is
gitignored and so are editor backups of it.

| Variable | Value | Why |
|---|---|---|
| `CLOVER_API_BASE` | `https://api.clover.com` | Production Clover |
| `VITE_CLOVER_MERCHANT_ID` | from `.env.local` | Which merchant |
| `CLOVER_PRIVATE_TOKEN` | from `.env.local` | **The one real secret.** Creates orders. No `VITE_` prefix, ever |
| `VITE_CLOVER_PUBLIC_TOKEN` | from `.env.local` | Tokenizes a card, cannot charge one |
| `CLOVER_ALLOW_PRODUCTION` | `yes` | The server refuses to boot against a live Clover host without it |
| `CLOVER_PRINTER_UUID` | `ZVZ9PRJ255V90` | The Station's roll |
| `APP_KEY` | a long random string | Generate with `openssl rand -hex 32`. Must equal the app's `VITE_APP_KEY` |
| `ALLOWED_ORIGINS` | `https://flourishbx.com` | The native app is allowed separately — see below |
| `MAX_CHARGE_DOLLARS` | `500` | Ceiling on any single charge |
| `TZ` | `America/New_York` | Hours are New York wall-clock; a UTC host would open the Bronx at 6am |

`PORT` is set by Railway; the server reads it.

The native app sends `capacitor://localhost` as its origin, which is not a
website and would be refused by `ALLOWED_ORIGINS` alone. Those schemes are
always allowed (`NATIVE_ORIGINS` in `server/guard.js`) — a browser will not let a
real site forge them, which is what makes the allowlist worth anything.

#### Deploy

```bash
railway up
```

Then check the boot log. **A correctly configured server prints no warnings:**

```
  Flourish · Clover proxy on http://localhost:8080
  API      https://api.clover.com
  Mode     PRODUCTION — real money
  Hours    Open daily 11AM–10PM · 11PM Fri & Sat  (America/New_York)
  App key  set
  Origins  https://flourishbx.com
  Config   complete — no warnings
  Printer  (unnamed) · ZVZ9PRJ255V90 · type MY_LOCAL
  Print to POST https://api.clover.com/v3/merchants/{mId}/print_event
```

Anything under `Config` is a variable you have not set yet.

#### Verify it from outside

```bash
# configured:true, and the printer named
curl https://<your-app>.up.railway.app/api/clover/health

# must be refused: no app key
curl -i https://<your-app>.up.railway.app/api/clover/inventory      # 401

# must succeed
curl -H "x-flourish-key: $APP_KEY" https://<your-app>.up.railway.app/api/clover/inventory
```

#### Rolling back

Railway keeps every deployment. **Dashboard → Deployments → the last good one →
⋯ → Redeploy.** It is live in about thirty seconds and needs no git operation,
which matters when the thing you are rolling back is why the shop cannot take
orders.

From the CLI: `railway deployment list`, then `railway redeploy <id>`.

If a bad *variable* is the problem, change it in the dashboard — that alone
triggers a redeploy. Rolling back code will not undo a wrong `CLOVER_API_BASE`.

The register is unaffected either way: orders that already reached Clover are in
Clover, and the app takes no money, so a broken deploy costs orders but never
money.

### App Store screenshots

```bash
VITE_API_BASE=https://flourish-api-production.up.railway.app \
VITE_APP_KEY=<the APP_KEY from Railway> \
npm run screenshots              # both size sets
npm run screenshots -- 6.5       # just one
```

Writes five screens at **both** sizes App Store Connect asks for:

| Slot | Pixels | Captured on | Output |
|---|---|---|---|
| 6.9" | 1290×2796 | iPhone 15 Pro Max | `screenshots/6.9/01-menu.png` … `05-confirmation.png` |
| 6.5" | 1284×2778 | iPhone 13 Pro Max | `screenshots/6.5/01-menu.png` … `05-confirmation.png` |

Both are generated so either upload slot can be filled. **A slot refuses any
file that is not one of its exact sizes** — 1290×2796 is rejected by the 6.5"
slot, which is a rejection that only shows up on the day you meant to submit.
The 6.5" slot also accepts 1242×2688 (iPhone 11 Pro Max); 1284×2778 is the
larger of the two.

**Every size is captured natively**, on a device whose screen is that size, and
the dimensions are read back out of each PNG header afterwards — the run exits
non-zero on any mismatch. Nothing is ever rescaled to fit a slot: resampling a
1290-wide capture down to 1284 is six pixels of difference and still leaves text
visibly soft, which reviewers see.

The device may not be installed — recent Xcodes ship a 6.9" Pro Max and nothing
older — so the script creates whichever phone it needs. Which device produces
which size was measured rather than read off a spec sheet: iPhone 12 Pro Max,
13 Pro Max and 14 Plus all capture 1284×2778.

Two things the script has to get right, and how it does.

**The screens have to show real data.** The app decides it is in preview mode
from `GET /health`, so a build with no proxy behind it reads *"ordering not
available right now"* on every screen. The build points at the hosted proxy, and
the calls needed to reach these screens — `/health`, `/quote`, `/loyalty` — are
all read-only.

**The confirmation screen must not cost a real order.** Reaching it normally
means `POST /orders`, which puts a genuine open ticket on the live register and
prints a genuine ticket in the kitchen for somebody to void. So a driver script
is injected into the built `dist/index.html` which wraps `fetch` and answers
`POST /api/clover/orders` — and only that — from a fixture. The app runs its own
code path the whole way and the screen renders exactly as it does in production;
nothing reaches Clover. The driver is injected **after** the build, is not in
`src/`, and is absent from anything `npm run release:ios` produces.

`simctl` cannot tap, so the driver also walks the UI from inside the web view,
clicking real elements. The app is built once and its web payload swapped per
screen, so both size sets show identical content rather than being two separate
runs that drifted apart on a price or a clock.

Other things it handles:

- **No real customer.** Screenshots are published on a public product page, so
  the details are a fake name and a 555 number reserved for fiction.
- **A clean status bar** — 9:41, full battery, full signal.
- **No debug text.** The fixture order id is shaped like a Clover id, because it
  is displayed on the confirmation screen as "Register #…".

### Native identity: version and display name

`ios/` is gitignored and regenerated by `npx cap add ios`, so anything typed
into Xcode by hand survives exactly until the next regeneration and then
vanishes without a word. That has happened twice:

- the **version** drifted — `package.json` said `1.0.0`, Xcode said `1.0`
- the **display name** came back empty, so the home screen read **"App"**

Both are the same bug, so both are fixed the same way: one authoritative value
in a committed file, stamped onto the generated project *after* `cap sync` has
finished rewriting it.

| What | Source of truth | Stamped onto |
|---|---|---|
| Version | `package.json` → `version` | `MARKETING_VERSION` |
| Build number | `package.json` → `flourish.ios.buildNumber` | `CURRENT_PROJECT_VERSION` |
| Display name | `capacitor.config.ts` → `appName` | `CFBundleDisplayName` in `Info.plist`, and `INFOPLIST_KEY_CFBundleDisplayName` |
| Device family | `package.json` → `flourish.ios.deviceFamily` | `TARGETED_DEVICE_FAMILY` |
| visionOS | `package.json` → `flourish.ios.supportsVision` | `SUPPORTS_XR_DESIGNED_FOR_IPHONE_IPAD` |

All of them go onto every build configuration, and a setting the regenerated
project does not contain is **added** rather than skipped — a search-and-replace
over an absent key silently does nothing, which is exactly the case the stamping
exists for.

```bash
npm run sync           # build -> cap sync -> icons -> native:stamp
npm run native:stamp   # just the stamp, against an existing ios/
```

**Why `appName` and not `package.json`.** `appName` is already the canonical app
name — Capacitor scaffolds the native projects from it — whereas `package.json`
`name` is an npm package identifier, `flourish-bx-app`, which is not what should
appear under the icon.

**Why the display name is written twice.** `CFBundleDisplayName` in `Info.plist`
is what iOS actually puts under the icon, and Capacitor ships a real
`Info.plist`, so that is the value that matters. `INFOPLIST_KEY_CFBundleDisplayName`
is what Xcode's **General → Display Name** field shows; it has no effect on the
build while `INFOPLIST_FILE` is set, but leaving it blank is how this looked
broken to anyone opening Xcode even when the built app was correct. Keeping both
equal means the two places someone might look agree.

The stamp reads the value back out of the plist afterwards and exits non-zero if
it did not stick — a stamp that silently did nothing is the failure the whole
thing exists to prevent. It also refuses to stamp an empty name or `"App"`:
stamping nothing is recoverable, shipping an app called nothing is not.

To check the real thing rather than the project file, read it out of a built app:

```bash
/usr/libexec/PlistBuddy -c "Print :CFBundleDisplayName" \
  .screenshot-build/Release-iphonesimulator/App.app/Info.plist
```

`src/test/release.test.js` fails if the name is empty, is `"App"`, or disagrees
with `capacitor.config.ts` — and skips the iOS half on a machine with no `ios/`,
including CI.

`CFBundleName` stays `$(PRODUCT_NAME)` — `"App"` — on purpose. It is the internal
bundle name, iOS only falls back to it when there is no display name, and
changing it means renaming the target that Capacitor's tooling expects to find.

### iPhone only

`TARGETED_DEVICE_FAMILY` is `"1"` — iPhone. It was `"1,2"`, which claims iPad
too, and App Store Connect blocks submission on *"You must upload a screenshot
for 13-inch iPad displays"* until you supply them. There is no iPad design; this
is a pickup ordering app for one restaurant. The claim was never true and Apple
was right to stop it.

`SUPPORTS_XR_DESIGNED_FOR_IPHONE_IPAD` is `NO`. An iPhone-only app is still
offered on Vision Pro as a *compatible* app unless it opts out.

> **The build setting is only half of the visionOS opt-out.** Availability is
> also an App Store Connect toggle, under **Pricing and Availability**. Nothing
> in this repo can set that; untick it there if it is on.

To change either, edit `package.json` and run `npm run sync`. A test fails if
the device family drifts back to include iPad.

### The build number

`flourish.ios.buildNumber` in `package.json`, stamped onto
`CURRENT_PROJECT_VERSION`. **Bump it before every upload** — App Store Connect
rejects a duplicate build number even when the version is unchanged.

This used to be left to whoever was uploading, on the reasoning that it moves
per upload and does not belong in the repo. That was wrong in practice: it left
the number in the one directory that gets regenerated, and it drifted like
everything else — App Store Connect had build 2 while the project on disk said
`1`. Stamping it costs one edit per upload and removes a rejection.

### Pointing the app at it

Nothing is hardcoded. `VITE_API_BASE` is empty in development, so calls stay
relative and Vite proxies them; a release build bakes in the hosted URL.

```bash
VITE_API_BASE=https://<your-app>.up.railway.app \
VITE_APP_KEY=<the same APP_KEY> \
npm run release:ios
```

`npm run release:ios` refuses to build if either is missing, if the URL points
at localhost, if it is not https (iOS blocks plain http), or if anything named
`VITE_CLOVER_PRIVATE_TOKEN` exists. It then runs `npm run sync` — **not bare
`npx cap sync`, which overwrites the app icons** — and opens Xcode.

Put both values in `.env.production.local` (gitignored) to avoid retyping them.
