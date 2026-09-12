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

**Correction to an earlier version of this entry.** It claimed
`PRINTED-MENU-PRICES.md` recorded the standalone Fried Chicken *side* at $7.99
against a live $6.00. That was wrong, and wrong the same way the soup mistake
was: I grepped for "Fried Chicken", found $7.99, and attributed it to the Side
group without checking which section it sat under. It is under **Lunch
Specials** (`F0Q8615QD5HMM`) — a different modifier in a different group, and
correct as written. The standalone Fried Chicken side does not appear in that
document at all, so there was no staleness to report.

**Fix:** confirm the intended Festival price. If it is $2, correct it in Clover
and regenerate; if $1 is right, `PRINTED-MENU-PRICES.md` needs updating instead.

---

## 7. The eight Seafood Fridays items have never been sold

**Answer to "how have these been selling?": they haven't.**

Across **600 recent orders / 630 line items**, all eight have **zero sales**:

```
0x  Fish Platter (Shrimp & 2 Sides)      0x  Seafood Stew Peas
0x  Crab Legs Platter (Shrimp & 2 Sides) 0x  Blue Crab $15
0x  Lobster Platter (Shrimp & 2 Sides)   0x  Pepper Shrimp & Mussels
0x  Shrimp $21.99                        0x  Salmon (Shrimp & 2 Sides)
```

They are dead SKUs. What staff actually ring is the **Lunch & Dinner twin**, and
those record the flavour properly — so it is not being taken verbally:

| Sold | Item | Flavours recorded |
|---|---|---|
| 46x | Salmon (`H9520PFNBT2NY`) | Honey Garlic, Sweet Chili, Jerk — every sale |
| 14x | Shrimp (`VHHCS7EDV70HC`) | Fried, Sweet Chili — every sale |
| 5x | Snapper Fish (`VQZ0T4XK707EC`) | via the Fish group |
| 1x | Crab Legs Platter $50 (`598S0BJH4J7DE`) | sides only |
| 1x | Blue Crab $20 (`PSGB77QNZR2WM`) | — |

So every Friday flavour on the flyer **already exists in Clover**, on the
everyday item. The Friday platters are unused duplicates with no groups.

**The money consequence.** The Friday prices are cheaper than the everyday ones
— Crab Legs $39.99 against $50, Salmon $21.99 against $22 — and the Friday SKUs
are never rung. So either customers are not getting the Friday price, or staff
are discounting by hand. Worth checking at the counter.

### Two ways to fix this, and the second is probably right

**Option A — make the Friday SKUs work.** Attach groups to each, then the app
sells them as the flyer describes:

| Item | Attach | Flyer wants | Clover group has | Missing |
|---|---|---|---|---|
| `06Z80836S0GZR` Fish Platter | `Fish` (`AJY3FTT4BRPHP`) + `Side With Meal` | fry, steam, escovitch, grill | Brown Stew, Escovitch, Steam Fish, Whiting, Snapper add-on | **fry, grill** |
| `BRMP82TR0Z45C` Crab Legs Platter | `Side With Meal` only | 2 clusters, shrimp + 2 sides | — | — |
| `A1YZ2ZD5CA1SW` Lobster Platter | a new flavour group + `Side With Meal` | grill, escovitch, fry, curry, thai | **no flavour group exists** | all five |
| `CAFAH5FKPTRW8` Shrimp | `Shrimp` (`4BY3GKC2SVJ90`) | pepper, steam, curry, grill, garlic | Garlic, Curried, Pepper, Sweet Chili, Grilled, Fried | **steam** |
| `0NQ5E11VABFDY` Salmon | `Salmon` (`ZR29AF0E4JPXA`) + `Side With Meal` | grill, jerk, honey garlic, thai | Sweet Chili, Grilled, Steamed, Honey Garlic, Jerk | **thai** |
| `32VDQ4G5J131P` Seafood Stew Peas | `Side With Meal` | lobster tail, shrimp, conch | — | — |
| `DH0P3NGRN9RNE` Blue Crab | nothing | — | — | — |
| `PH221AJ7W66EA` Pepper Shrimp & Mussels | nothing | — | — | — |

Also needed for A: **Thai** on lobster and salmon, **Fry** and **Grill** on fish,
and **Steam** on shrimp do not exist as modifiers anywhere and would have to be
created.

**Option B — delete the Friday duplicates.** The everyday items already carry
the flavours and the sides, and they are what staff use. Sell those, and make
Friday a *price* difference rather than a separate SKU. Fewer items, no
duplicate to keep in step, and nothing for staff to learn.

B is simpler and matches what is actually happening at the register. A is
faithful to the flyer's separate pricing. **This is a business decision, not a
technical one** — say which and the app follows. Until then the app lists all
eight as flat-priced items with no options, which is what Clover contains.
## 8. Two chicken plates are $0.00 and would ring free

**Where:** `YQH6NFFB34SVM` BBQ Chicken and `49BD3KVSBHXRR` Curry Chicken, both
**$0.00** live
**Problem:** the plate rings free. Both are hidden in the app *for this reason*
— not because they are off the menu.

Curry Chicken's exclusion used to say "sold only as the $8 lunch special". That
was wrong: **the item sold 15 times in its own right** in 600 orders. It is a
real dish with no price. The reason in the generator now says so.

**Fix:** price both in the Clover dashboard. Then say the word and the app sells
them — Curry Chicken clearly has demand.

Until then they stay hidden, because un-hiding a $0.00 plate gives food away.

---

## 9. Breakfast is blocked at the register, not in the app

Fifteen Breakfast items are live in Clover and none is in the app. That is not
an app decision: **twelve of the fifteen are $0.00**, and the porridges have no
priced size group at all, so they would ring free.

Priced and sellable today: Fry Dumpling $1.10, Festival $1.50, Fritter $2.00.

**Fix:** price the twelve in Clover. The generator already keeps `Breakfast` in
`KEEP_CATEGORIES` and already has menu copy for all fifteen, so they appear on
the next regeneration with no code change.

Leaving them out is deliberate and safe until then. See
`docs/EXPORT-VS-CLOVER.md`.

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

---

## 10. The wrong side group is attached to ten items  ← do this first

`Side With Meal` was meant to go onto the Seafood Fridays items and the Lunch
Specials. What actually got attached is the **standalone `Side` group**. Same
word on the dashboard, different object, and the two price the same food
differently on purpose:

| | Group id | White Rice | Mac & Cheese | Options |
|---|---|---|---|---|
| **Side With Meal** | `YQWN3PKBKV9NG` | $0.00 | $0.00 | 14 |
| **Side** (standalone) | `S032100JQ3P4T` | $5.00 | $6.00 | 21 |

Clover **adds** a modifier to the item's base price. So on the register today:

> Crab Legs Platter (Shrimp & 2 Sides) — $39.99 + White Rice $5.00 = **$44.99**

on a flyer that says two sides are included. The standalone group also puts
Pepper Shrimp ($15), Jerk Chicken ($6) and Chicken Breast ($5) in front of a
customer as "sides" on a seafood platter.

**Affected items** — all ten carry `Side` and none carries `Side With Meal`:

| Clover id | Item | In the app? |
|---|---|---|
| `BRMP82TR0Z45C` | Crab Legs Platter (Shrimp & 2 Sides) | yes |
| `A1YZ2ZD5CA1SW` | Lobster Platter (Shrimp & 2 Sides) | yes |
| `32VDQ4G5J131P` | Seafood Stew Peas | yes |
| `DH0P3NGRN9RNE` | Blue Crab ($15, Friday) | yes |
| `PH221AJ7W66EA` | Pepper Shrimp & Mussels | yes |
| `21RNMJ880YCMC` | Crab Legs & Shrimp | delisted |
| `K7EX5APPAXPEJ` | Lobster Roll & Fries | delisted |
| `06Z80836S0GZR` | Fish Platter (Shrimp & 2 Sides) | hidden |
| `CAFAH5FKPTRW8` | Shrimp (Friday) | hidden |
| `0NQ5E11VABFDY` | Salmon (Shrimp & 2 Sides) | hidden |

### What the app does in the meantime

It drops the group. Those five rendered items keep their real base price and
offer **no sides at all** — exactly the shape they had before — because the
alternative was worse in both directions: a base price plus a priced group is
the double-ring shape the generator zeroes, so Crab Legs Platter came out of the
first regeneration as base $0 advertised **"from $1"**, priced off its corn
bread. `MISATTACHED_SIDE_GROUP` in `scripts/generate-menu.mjs` holds the list,
the generator shouts about it on every run, and tests assert the ids are still
wrong so the map cannot outlive the problem.

### The fix

On each of the ten: **remove `Side`, add `Side With Meal`.** Then delete the id
from `MISATTACHED_SIDE_GROUP` and regenerate. Order matters — attach first,
regenerate second; regenerating first just re-reports the same thing.

**Lunch Specials (`KW21XBQ6XVTGA`) has no side group either.** It was on the same
list and did not get one. It does have an `Extra Side` modifier at $2.00 inside
its own group, which may be what was meant — if a lunch special is supposed to
come with a choice of side, `Side With Meal` still needs attaching.

---

## 11. Whiting Fish X1 went to the standalone group, not the meal group

Intended: Side With Meal → Whiting Fish X1 → $3.00.
Actual: the standalone `Side` group's "Whiting Fish  X1" (two spaces in the
name) went $2.50 → $3.00, and Side With Meal's "Whiting Fish X1" was set to
$2.50.

Nothing is mischarged — the app follows Clover on both — but if $3.00 with a
plate is the intent it is one field, and the app picks it up on the next
regeneration. See PRINTED-MENU-PRICES.md.

Worth tidying while you are there: the double space in `Whiting Fish  X1`. The
export carries no modifier ids, so the server resolves modifiers **by name**
against Clover at order time. The name matches today, so it works; it is the
kind of difference that stops matching after someone "fixes the typo" in one
place only.

---

## 12. Clover has no Drinks category any more

Live Clover files both drink items — `Drink` (`D7MBX5PWRCGCE`) and
`Pina Colada` (`EWT1J5Q9K7KX0`) — under **Lunch & Dinner**, and there is no
Drinks category at all. The app therefore has no Drinks section: the two items
appear in Lunch & Dinner.

Per the earlier decision this is left alone, because the half that actually
matters is `noPrep` — a Coke must never be the thing that decides when an order
is ready — and that is keyed by item id in `NO_PREP_IDS`, independent of
category. Both drinks keep it.

The generator deliberately will not pin an item to a category Clover does not
have: a pin like that is a fiction, and the app would show a heading the
register disagrees with. Create the category at the register and the section
comes back on the next regeneration.

---

## 13. Coca Cola $3.00 sits next to Large Can Soda $1.50

In the `Drink` group (`FT5JBR312DVTA`), three rows are the same kind of thing at
three prices:

| Option | Price |
|---|---|
| Can Soda | $1.25 |
| Large Can Soda | $1.50 |
| Coca Cola | $3.00 |

All three render in the app, in that group's order — Large Can Soda is 14th in
the list and Coca Cola is 17th, three rows apart on the same sheet. A customer
scrolling the drink options sees a can of Coke for $1.25, a large can for $1.50,
and "Coca Cola" for $3.00, with nothing on any of them saying what size it is.

It reads as one product priced twice, and the customer picks $1.25. If the $3.00
is a 20oz bottle it needs to say so — `Coca Cola (20oz)` and
`Can Soda (12oz)` would settle it. If it is a duplicate, delete it.
