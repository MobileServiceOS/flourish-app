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
├─ index.html                  page shell, font preloads
├─ package.json                dependencies and commands
├─ vite.config.js              dev server + build
├─ capacitor.config.ts         native app id and name
├─ scripts/
│  └─ generate-menu.mjs        Clover export -> menu data
└─ src/
   ├─ main.jsx                 mounts React
   ├─ App.jsx                  all screens and state
   ├─ styles.css               full stylesheet
   ├─ data/
   │  └─ menu.data.js          GENERATED — never hand-edit
   └─ lib/
      ├─ money.js              cent-accurate rounding
      ├─ loyalty.js            tiers, rewards, discount rules
      └─ storage.js            account persistence
```

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

- Full menu from Clover — 58 items across Lunch & Dinner, Seafood Fridays, Breakfast
- Sizes, flavors, and two included sides, priced exactly as Clover prices them
- Cart, checkout, tip, tax, live order tracking
- Customer accounts with points that persist across launches
- Reward redemption that applies a real discount to the cart
- Savings badges showing what ordering direct beats Uber Eats by
- Staff 86 control — tap the lock icon on the menu to mark items sold out

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
