# The curated export has drifted from the register

`src/data/menu.data.js` is generated from a manual Clover inventory export. That
export is now a **subset** of the live register, and the two disagree about
categories. Nobody notices until a regeneration, which is how this surfaced:
regenerating from live Clover produced 47 items against the committed 31,
**emptied the Drinks section**, and added 15 Breakfast items nobody has vetted.

**Measured 2026-09-11** against live `api.clover.com`, merchant
`W2K2XR2X54VV1` — 124 items, 4 categories — compared with the committed data
plus the generator's `DELISTED`, `SKIP_ITEMS` and `KEEP_CATEGORIES` filters.

Nothing has been changed. This is the shape of the problem.

---

## 1. The Drinks category does not exist in Clover

Live categories are exactly:

```
Catering Orders | Seafood Fridays | Lunch & Dinner | Breakfast
```

There is **no Drinks category**. Both drink items are filed under Lunch &
Dinner:

| Item | App says | Live Clover says |
|---|---|---|
| `D7MBX5PWRCGCE` Drink | Drinks | **Lunch & Dinner** |
| `EWT1J5Q9K7KX0` Pina Colada | Drinks | **Lunch & Dinner** |

So the export was taken when a Drinks category existed, or it was edited by
hand. Either way a regeneration moves both items into Lunch & Dinner and the
Drinks section disappears — which is exactly what happened.

It also breaks something subtler. `prep.js` marks the Drinks *category* as
`noPrep`, so drinks never push out a cart's ready window. Landing them in
Lunch & Dinner makes a Coke a 15-minute item again.

**Where the fix belongs: the register.** Create a `Drinks` category in Clover
and assign both items to it. The app's category order, the `noPrep` rule and
the "Refreshing beverages" subtitle all key off that name, and inventing the
category in the generator would mean the app claims a grouping the register does
not have — the same class of fiction as a made-up price.

*Alternative, if you would rather not add a category:* an `ITEM_CATEGORY` pin
already exists in the generator for items Clover files in two places. Pinning
these two would work, but it asserts a category Clover does not have at all,
which is weaker than the Seafood Fridays pins that only choose between real
ones.

---

## 2. Fifteen Breakfast items are live and absent from the app

`KEEP_CATEGORIES` includes `Breakfast`, the generator's `DESC` map already has
copy for all fifteen, and the committed data has **none of them**. So the export
simply did not include Breakfast.

| Item | Live price |
|---|---|
| Fry Dumpling | $1.10 |
| Festival | $1.50 |
| Fritter | $2.00 |
| Ackee N Saltfish | **$0.00** |
| Ackee n Chicken Back | **$0.00** |
| Cabbage N Cornbeef | **$0.00** |
| Butterbean and Saltfish | **$0.00** |
| Cook Up Saltfish | **$0.00** |
| Callao | **$0.00** |
| Cornmeal / Banana / Hominy Corn / Peanut / Oats / Mix Up Porridge | **$0.00** each |

**Twelve of the fifteen are $0.00.** Three of those carry a priced size group
(Small/Medium/Large on the saltfish dishes), so they would ring correctly; the
porridges appear to have no priced group at all and would ring **free**.

**Where the fix belongs: the register first, then the export.** Pricing has to
be right in Clover before these can be sold anywhere. Until then, leaving
Breakfast out of the export is accidentally protective.

If breakfast is not sold through the app on purpose, the honest fix is to remove
`Breakfast` from `KEEP_CATEGORIES` and delete its `DESC` entries, so the intent
is written down instead of resting on an export that happens to omit it.

---

## 3. Nothing in the app is missing from Clover

Every one of the 32 committed items exists live, so no stale id can fail to
resolve at order time. That is the one direction of this drift that is clean.

---

## 4. Catering is correctly excluded

`Catering Orders` is a live category that `KEEP_CATEGORIES` leaves out, and the
generator also skips names containing `(Catering`. Between them, 30-odd catering
items stay out. Working as intended; noted so it is not mistaken for drift.

---

## So where does the fix belong?

| Divergence | Register | Export | Generator |
|---|---|---|---|
| Drinks category missing | **yes** — create it, assign 2 items | re-export after | no |
| 12 Breakfast items at $0.00 | **yes** — price them | re-export after | no |
| Breakfast absent from the export | — | yes, if breakfast should sell | or drop `Breakfast` from `KEEP_CATEGORIES` if it should not |
| Catering excluded | — | — | working as intended |

**Order of operations.** Fix the register first, then export, then regenerate.
Regenerating from the current export keeps the drift; regenerating from live
Clover today would empty Drinks and add twelve free porridges.

## Why not just generate from the live API?

Tempting — it would remove the manual export step and the drift with it. I built
and tested that path: `scripts/` can read every item and modifier group from the
API and write the same xlsx shape the generator expects, and the generator ran
on it cleanly.

**It is not safe yet**, for the reasons above: the live register has no Drinks
category and a dozen unpriced breakfast items. The curated export is doing real
work — it is a filter, not just a snapshot, and that filtering has never been
written down.

Once 1 and 2 are fixed at the register, generating straight from the API becomes
the better design, because the drift cannot happen. The prerequisite is that
every intentional exclusion lives in the generator where it can be read, rather
than in whatever the last export happened to contain. `docs/HIDE-REASONS-AUDIT.md`
is the start of that: 8 of 21 current exclusions carry no stated reason.
