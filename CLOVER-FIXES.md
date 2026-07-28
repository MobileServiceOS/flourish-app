# Clover inventory issues found

Found while mapping the app to your live Clover export (`inventory-export-v2.xlsx`).
The app already works around all four. **Clover itself still needs correcting** — these
affect what rings up at the register, on Ordering Tools, and on every delivery platform
that syncs from your inventory.

Ordered by what they cost you.

---

## 1. Baked Chicken double-charges — ring test this today

**Where:** Items → Baked Chicken
**Problem:** The item has a base price of **$15.00** *and* a modifier group ("Baked Chicken")
containing Medium $15 / Large $18. Clover modifier prices **add** to the item price.

| Customer orders | Should ring | Actually rings |
|---|---|---|
| Baked Chicken, Medium | $15.00 | **$30.00** |
| Baked Chicken, Large | $18.00 | **$33.00** |

**Fix:** Set the Baked Chicken item price to **$0.00** and let the modifier group carry the
price — exactly how Oxtail, Jerk Chicken, and Fried Chicken are already set up.

**Why it matters:** Every other sized plate uses base $0. This one is the outlier, which is
why it slipped through. Worth ringing up a test order to confirm before/after.

---

## 2. Goat Head Soup rings up free

**Where:** Modifier Groups → Soup
**Problem:** `Medium Goat` and `Large Goat` are both priced **$0.00**. Chicken and Seafood
in the same group are priced correctly.

| Modifier | Price |
|---|---|
| Medium Chicken | $5.00 |
| Large Chicken | $10.00 |
| **Medium Goat** | **$0.00** |
| **Large Goat** | **$0.00** |
| Medium Seafood | $10.00 |
| Large Seafood | $15.00 |

**Fix:** Set real prices. Your printed menu lists goat head soup at **$5 / $10**, matching
chicken — but confirm before entering, I did not want to assume.

**App behavior meanwhile:** both goat options are hidden from customers rather than sold for
$0. The other four soups sell normally.

---

## 3. A $1.50 add-on is filed as a Wings size

**Where:** Modifier Groups → Wings
**Problem:** The group holds `Medium $15`, `Large $18`, and a third entry literally named
`Wings` priced **$1.50** — clearly a single extra wing, sitting in the size group.

Anyone picking that option gets a wings plate for **$1.50**. It also drags your listed
starting price down to $1.50 anywhere the range is displayed.

**Fix:** Move it out of the size group into its own add-on group (something like
"Extra Wings"), or rename it "Extra Wing (1)" and attach it as an add-on rather than a size.

**App behavior meanwhile:** hidden. Wings show $15–$18 and default to Medium.

---

## 4. Pork prices disagree with your printed menu

**Where:** Modifier Groups → Pork
Not a bug — a mismatch you should settle, since the two sources say different things.

| | Clover (rings up) | Printed menu |
|---|---|---|
| Brown Stew, Medium | $14.00 | $20.00 |
| Brown Stew, Large | $17.00 | $25.00 |
| Jerk, Medium | $15.00 | $20.00 |
| Jerk, Large | $20.00 | $25.00 |

You're charging **$5–$8 less** per pork plate than your own menu advertises.

**App uses Clover**, since that's what actually charges the customer. If the printed prices
are the intended ones, update Clover and tell me — the app picks it up on the next export.

---

## Other mismatches worth a look

Clover is authoritative in the app for all of these. Listed so you can decide which source
is wrong.

| Item | Clover | Printed menu |
|---|---|---|
| Penne Alla Vodka | $15.00 | $18.00 |
| Oxtail Pasta | $25.00 | $24.00 |
| Chicken Mac & Cheese (side) | $6.99 | $7.00 |
| Chicken & Waffles | $15.99 | $15.00 |
| Lunch Special (chicken) | $7.99 | $8.00 |
| Lunch Special — Curry Goat | $12.00 | not listed |
| Lunch Special — Oxtail | $13.50 | not listed |
| Lunch Special — Wings | $10.50 | not listed |

Also: **Whiting Fish $14** exists as a full meal in the Fish group but isn't on the printed
menu. And the **Salmon flavors differ** — Clover has Sweet Chili, Grilled, Steamed, Honey
Garlic, Jerk; the printed menu lists Pepper, Garlic, and Curry instead of Steamed and Jerk.

---

## Not in the app, on purpose

- **Catering Orders (62 items)** — all $0 with no modifiers, priced by quote. Catering isn't
  a pickup flow; it belongs on a phone call or a form. Say the word and I'll build a catering
  request screen that emails you instead of trying to price it.
- **Gift card, Boil Food** — no price set in Clover.
