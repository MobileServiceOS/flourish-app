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
├─ package.json                dependencies and commands
├─ vite.config.js              dev server + build + test config
├─ capacitor.config.ts         native app id and name
├─ scripts/
│  └─ generate-menu.mjs        Clover export -> menu data
└─ src/
   ├─ main.jsx                 mounts React
   ├─ App.jsx                  state owner and router — nothing else
   ├─ styles.css               full stylesheet
   ├─ components/
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
   ├─ lib/
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

94 tests. They cover the things that cost money if they break: pickup-slot
boundaries around closing time, reorder keeping its modifiers and notes,
special instructions reaching the kitchen ticket, and a WCAG contrast check
that recomputes every text colour pairing straight out of `styles.css`.

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

- Full menu from Clover — 43 items across Lunch & Dinner, Seafood Fridays, Drinks,
  each with a one-line description
- A **Popular** section up top showing the six the shop is known for — the same
  item objects the categories use, not copies
- Sizes, flavors, and two included sides, priced exactly as Clover prices them
- Category chips that smooth-scroll, and highlight as you scroll past sections
- Cart, checkout, tip, tax, order confirmation and live status
- **Pickup times** on a 15-minute grid up to close (10PM, 11PM Fri & Sat), with
  ASAP as the default and a proper "we're closed" state outside hours
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

## What is not wired yet

**Clover payments and order push.** Checkout currently simulates and prints nothing
to the kitchen. To finish it you need, from the Clover Dashboard
(gear icon → View all settings):

1. **Business Operations → API tokens** — Read/Write on Orders, Inventory,
   Customers, Merchant, Payments
2. **Ecommerce → Ecommerce API Tokens** — type "Hosted iFrame + API/SDK",
   for in-app card payment
3. **Merchant ID** — About Your Business → Merchants

Both token pages require two-factor auth enabled and location access allowed.

Put them in `.env.local` (already gitignored — never commit these):

```
VITE_CLOVER_MERCHANT_ID=
VITE_CLOVER_PUBLIC_TOKEN=
CLOVER_PRIVATE_TOKEN=
```

Test against a sandbox merchant at `sandbox.dev.clover.com` before going near the
live register.
