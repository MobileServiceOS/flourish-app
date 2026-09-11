# Clover inventory issues found

Found while mapping the app to your live Clover export (`inventory-export-v2.xlsx`).
The app works around the first five. **Clover itself still needs correcting** — these
affect what rings up at the register, on Ordering Tools, and on every delivery platform
that syncs from your inventory.

Number 6 is deliberately NOT worked around: it is a live price, and overriding a price in
the app would make it disagree with the till. Only Clover can fix that one.

Ordered by what they cost you.

---

## 1. Baked Chicken — delisted, still live in Clover

**Where:** Items → Baked Chicken
**Status:** No longer offered. Removed from the app.

It is still sitting in the Clover inventory, and it still has the double-charge bug: a
base price of **$15.00** *and* a modifier group priced Medium $15 / Large $18, which
Clover **adds together**. Anyone ringing it up at the register gets **$30.00**.

**Fix:** Hide or delete the item in Clover. Until then it can still be sold at the counter
at twice its price, and it will still sync to any delivery platform reading your inventory.

**App behavior meanwhile:** delisted by id in `scripts/generate-menu.mjs`, so it stays off
the menu even after a fresh export.

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

## 5. Seafood stew peas is filed as a *size* of regular stew peas

**Where:** Modifier Groups → Stew Peas
**Problem:** The group holds `Medium $15`, `Large $18`, and `Seafood $30`. Seafood stew
peas is a different dish — it already exists as its own item at $30 — and it only gets
cooked Friday and Saturday.

Sold from inside this size group it:

- rings up **any day of the week**, including days you don't make it
- reads to customers as a third size of ordinary stew peas
- drags the listed price range on the Stew Peas row up to **$15–$30**, so the menu
  advertises a top price for something that usually isn't available

**Fix:** Remove `Seafood` from the Stew Peas size group. The standalone
**Seafood Stew Peas** item already covers it at the right price.

**App behavior meanwhile:** hidden. Stew Peas shows $15–$18 with Medium and Large only.
Seafood Stew Peas is sold as its own item, one size, and is greyed out with
**FRI & SAT ONLY** from Sunday to Thursday.

---

## 6. Sides that should carry an upcharge with a plate are $0 in Clover

**Corrected 2026-09-11.** An earlier version of this entry said `0VK0R5TDR2FRC`
($6 Fried Chicken) was in **Side With Meal**. It is not — a live query against
`/v3/merchants/{mId}/modifier_groups?expand=modifiers` shows that id belongs to
the **standalone Side** group. The two groups hold separate modifier objects:

| | Side With Meal (`YQWN3PKBKV9NG`) | standalone Side (`S032100JQ3P4T`) |
|---|---|---|
| Fried Chicken | `W63ZR0Q92XER4` — **$0.00** | `0VK0R5TDR2FRC` — $6.00 |
| Whiting Fish | `WHGNBP3G67PJP` — **$0.00** | `GHTNE4XTHNVAC` — $2.50 |
| Shrimp | `FDBPRRCP57X8R` — $5.00 ✓ | `36XNV6AG9FWCM` — $5.00 |
| Seafood Mac | `H5GZAVN2CQSHJ` — $3.50 ✓ | `PJHN20XXA5STW` — $8.00 |
| Pepper Shrimp | *not in this group* | `YVXSHPFGPY6TY` — $15.00 |

**Problem:** the shop charges for fried chicken and whiting fish with a plate.
Clover has both at **$0.00** in the meal group, so the register charges nothing
for them — and the app, which sends no line prices, showed "Included" and was
telling the truth about the till. This is the shop losing money on every plate
that picks one, not a customer being overcharged. The direction matters: nobody
is surprised at the counter, so it is revenue leakage rather than a trust bug.

**Fix in Clover:** Modifier Groups → Side With Meal, set

- `Fried Chicken` (`W63ZR0Q92XER4`) → **$6.00**
- `Whiting Fish X1` (`WHGNBP3G67PJP`) → **$2.50**

Those are the standalone Side prices, chosen deliberately for want of any
meal-context price in Clover to read.

**App behaviour meanwhile — read this carefully, it is the opposite of the usual
direction.** The app now *shows* those upcharges, declared in `SIDE_UPCHARGE` in
`scripts/generate-menu.mjs`. Clover still charges its own price, which is $0, so
until the dashboard is corrected **the app quotes a total higher than the till
takes**. That is the same rule-1 / rule-2 divergence as the items in
PRINTED-MENU-PRICES.md, and the generator reports it on every run — but it is
worth being explicit that the customer pays *less* at the counter than the app
said, not more.

If the $6 exists to cover a delivery platform's commission it belongs in that
platform's own menu, not in the register every other channel reads from. Say so
and I will lower it.

---

## 6b. Pepper Shrimp cannot be ordered as a side with a plate

**Where:** Modifier Groups → Side With Meal — `Pepper Shrimp` is absent
**Problem:** it exists only as a standalone side (`YVXSHPFGPY6TY`, $15.00). There
is no meal-group modifier for it, so the app cannot offer it with a plate however
it is configured. Left out by decision rather than worked around.

**Fix, if it should be orderable with a plate:** add a `Pepper Shrimp` modifier to
the Side With Meal group at the intended upcharge, then regenerate the menu. No
code change is needed — it appears on its own.

---

## 6c. Festival's standalone price may be wrong

**Where:** Modifier Groups → Side (`S032100JQ3P4T`) → `Festival` (`SJ27CE6ZE34BW`), **$1.00**
**Problem:** live Clover says $1.00. The shop has described it as **$2 each**. One
of the two is wrong and I did not guess which, so nothing was changed.

Also stale: `PRINTED-MENU-PRICES.md` records the standalone Fried Chicken side as
Clover $7.99; live Clover says $6.00. The xlsx export that document was written
from is older than the current register.

**Fix:** confirm the intended Festival price. If it is $2, correct it in Clover
and regenerate; if $1 is right, `PRINTED-MENU-PRICES.md` needs updating instead.

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
  a pickup flow and is not going in the app; it stays a phone call. The generator skips any
  item with "(Catering" in its name, so these never reach customers even though they sit in
  the same Clover inventory.
- **Gift card, Boil Food** — no price set in Clover.
