# Seafood Fridays: pricing, and what the app shows

**Nothing is being deleted from Clover.** All eight items stay in the register.
This is about what the app offers, and about one pricing question that is yours
to decide.

Measured against live `api.clover.com` on 2026-09-11, plus 600 orders of sales
history.

---

## 1. The number worth looking at

**Crab legs with shrimp costs a customer $55.00 midweek and $39.99 on Friday.**

| | Friday SKU | Everyday route |
|---|---|---|
| Crab legs | `BRMP82TR0Z45C` **$39.99** — shrimp and two sides included | `598S0BJH4J7DE` $50.00 **+ $5.00** shrimp as one of the two sides = **$55.00** |
| Lobster | `A1YZ2ZD5CA1SW` **$39.99** | `VGZYVZCB2NCRY` $45.00 **+ $5.00** shrimp = **$50.00** |

A **$15.01** gap on crab legs and **$10.01** on lobster — and the Friday SKUs
have **never been rung**, zero sales in 600 orders. So on any given Friday a
customer either pays $55.00 for something advertised at $39.99, or a member of
staff discounts it by hand.

That is the decision to look at. Three ways to close it:

1. **Sell the Friday SKUs.** They need `Side With Meal` attached — see below.
   The flyer price then rings by itself.
2. **Drop the everyday price** to $39.99 all week and retire the Friday
   distinction. Simplest, and costs $10 a plate midweek.
3. **Leave it.** Staff keep discounting manually. The app cannot show a price
   the register will not charge, so the app would keep quoting $55.00.

**There is no fourth option where the app applies a Friday price by itself.**
The app sends no line prices — Clover prices its own orders, which is what keeps
the till and the app from ever disagreeing about money — and Clover has no
scheduled or day-dependent item pricing. The day locks decide whether something
can be ordered today, not what it costs. A Friday price has to exist in Clover
as a price, on some item.

---

## 2. What the app now shows, and why

Five items in Seafood Fridays:

| | Price | Why |
|---|---|---|
| Seafood Stew Peas | $30.00 | only one of its kind |
| Blue Crab | $15.00 | the flyer's price; the $20 twin is hidden |
| Pepper Shrimp & Mussels | $17.00 | only one of its kind |
| Crab Legs Platter (Shrimp & 2 Sides) | $39.99 | a real $15.01 Friday saving |
| Lobster Platter (Shrimp & 2 Sides) | $39.99 | a real $10.01 Friday saving |

Three are **hidden from the app** and stay in the register
(`HIDDEN_ITEMS_IN_APP` in `scripts/generate-menu.mjs`):

| Hidden | Friday | Everyday twin | Verdict |
|---|---|---|---|
| Fish Platter `06Z80836S0GZR` | $30.00 | Snapper Fish $30.00, 3 preparations + 2 sides | same price, fewer choices |
| Salmon `0NQ5E11VABFDY` | $21.99 | Salmon $22.00, 4 flavours + 2 sides | one cent, fewer choices |
| Shrimp `CAFAH5FKPTRW8` | $21.99 | Shrimp $20.00, 6 flavours + 2 sides | **dearer**, fewer choices |

### Why those three and not the other two

Not the price — the **dish's identity**.

Fish, salmon and shrimp are *flavour-defined*: honey garlic salmon and jerk
salmon are different dishes, and the everyday items carry those flavour groups.
A Friday SKU with no flavour group cannot express the dish at all, so it is a
strictly worse version of something already on the menu — same money or more,
nothing to choose.

Crab legs and lobster have **no flavour group even on the everyday item**. Sides
are the whole of their identity. So `Side With Meal` alone makes the Friday SKU
completely correct, and it carries a real saving. That is why those two are worth
keeping and the other three are not.

A customer seeing Salmon $21.99 and Salmon $22.00 on the same screen learns
nothing and may pick the worse one. That trap is what hiding removes.

---

## 3. What to do at the register, in order

**Attach `Side With Meal` (`YQWN3PKBKV9NG`) to both:**

- `BRMP82TR0Z45C` Crab Legs Platter (Shrimp & 2 Sides)
- `A1YZ2ZD5CA1SW` Lobster Platter (Shrimp & 2 Sides)

Then, in this order:

1. **Attach the group in Clover.** Nothing in the app changes yet.
2. **Export fresh inventory** — Items and Modifier Groups.
3. **Regenerate:** `npm run menu -- <the new export.xlsx>`
4. **Check the diff** on `src/data/menu.data.js` before committing. The only
   change should be a `Side With Meal` group appearing on those two items.
5. **`npm test`.** Two things flip green-to-meaningful here: the side upcharges
   apply to the new group automatically, and `PENDING_AT_REGISTER` in
   `src/test/copyClaims.test.js` becomes stale — a test fails telling you to
   delete those two entries, because the names no longer promise anything the
   data cannot keep.

### What breaks if the order is wrong

**Regenerating before attaching the group:** nothing breaks. The two items stay
flat-priced with no sides, exactly as today. Safe, just pointless.

**Attaching the group and never regenerating:** nothing breaks. Staff can pick
sides at the register; the app simply does not offer them. Safe.

**Telling the app about the sides before Clover has them** — i.e. adding the
group by hand to `menu.data.js` or to the generator — **is the one that breaks
orders.** The app would send side modifiers the register cannot resolve, and the
proxy refuses the whole order with `409 MODIFIER_UNRESOLVED` rather than let it
ring up wrong. Refusing is the designed behaviour, and it means a customer
cannot order crab legs at all. Do not do this; let the export carry it.

**Exporting before the Clover change** is the likely mistake, and it looks like
success: the regeneration runs cleanly and changes nothing. Check the diff at
step 4 — an empty diff means the export predates the change.

### One hazard that is not about ordering

`npm run menu` was broken until recently (`XLSX.readFile` is not a function in
the xlsx ESM build), so every data change this session was applied by script
instead. It works now, which means a regeneration will also pick up **everything
else that has changed in Clover since the last export**. Read
`docs/EXPORT-VS-CLOVER.md` first: the register currently has no Drinks category
and fifteen Breakfast items, twelve of them at $0.00. Step 4's diff is the
control, and it is not optional.

---

## 4. Still open, from the sales history

The Friday platters have **zero sales** and the everyday twins are what staff
ring. Attaching the groups makes the Friday SKUs usable, but somebody still has
to ring them on a Friday for the flyer price to reach a customer. Worth a word
at the counter — this is a training question as much as a data one.


---

## Update — the side group was attached, but the wrong one (2026-09-11)

The order of operations in this document was: attach `Side With Meal` at the
register first, regenerate second. The attach happened. What got attached to all
ten Seafood Fridays items was the **standalone `Side` group**
(`S032100JQ3P4T`), not `Side With Meal` (`YQWN3PKBKV9NG`).

They are different Clover objects with the same word on the dashboard, and the
difference is the whole point of the two groups existing: the meal group prices
an included side at $0, the standalone group prices it as something you buy on
its own. So Crab Legs Platter now rings **$39.99 + $5.00 white rice = $44.99**
at the register, and the first regeneration put it in the app as base $0
advertised "from $1", priced off its corn bread.

Crab legs and lobster were kept in the app on the reasoning in this document —
sides are the whole of their identity, so `Side With Meal` alone makes them
correct. That reasoning is unchanged; they just do not have it yet. Until they
do, the generator drops the wrong group and they show their real price with no
sides, exactly as before.

**The crab legs price question is still open and unchanged:** $55.00 midweek
against $39.99 on the flyer, and there is still no mechanism for a Friday price.

Full detail, and the ten ids, in CLOVER-FIXES.md §10.


---

# Are the Friday shrimp and salmon prices an error? (2026-09-12)

Asked directly, so answered directly: **I think yes — a flyer artifact rather
than intent — and the shrimp is the one worth querying.**

## The pattern

| Dish | Friday SKU | Everyday | Difference |
|---|---|---|---|
| Crab legs | $39.99 | $55.00 like-for-like | **$15.01 cheaper** |
| Lobster | $39.99 | $50.00 like-for-like | **$10.01 cheaper** |
| Salmon | $21.99 | $22.00 | 1c cheaper |
| Shrimp | $21.99 | $20.00 | **$1.99 DEARER** |

## Why it reads as an artifact

**The two suspect items share a price; their everyday twins do not.** Friday
salmon and Friday shrimp are both $21.99, while the everyday dishes are $22.00
and $20.00. That is what you get from a flyer written as "Friday seafood
platters — $21.99" and entered against each dish, not from two separate pricing
decisions. If someone had priced each Friday dish against its own weekday
price, the two Friday numbers would differ.

**A one-cent discount is not a discount.** $21.99 against $22.00 is charm
pricing, not a promotion. Nobody sets out to take a penny off. It is the
signature of a round promotional number chosen without reference to the
everyday price at all — and once you accept that for the salmon, the shrimp
follows from the same act.

**The Friday version is the lesser dish.** Both Friday SKUs carry **no flavour
group**, where the everyday salmon has four flavours and the everyday shrimp has
six. Charging $1.99 more for a dish with fewer choices is not a plausible
intent; it is what happens when the flat price lands on the one dish whose
weekday price was already below it.

## What I would ask the shop

Just the shrimp: *"Friday shrimp rings $21.99 and the everyday shrimp rings
$20.00 — should Friday be lower, or is the Friday platter a different portion?"*
If it is genuinely a bigger plate the price is defensible and only the framing
needed fixing, which it now has. The salmon's cent is not worth anyone's time
either way.

## What the app does in the meantime

Neither appears in `FRIDAY_COMPARISON`, so **neither carries a saving claim** —
and the helper refuses one even if someone adds it, because a comparison that is
not a saving is a lie with a number on it. The section subtitle says which half
of Seafood Fridays is a price and which half is simply a Friday-only dish, and
the Friday banner names crab legs and lobster rather than implying a deal across
the board.

Both dishes are still listed and still orderable. Listing a dish and declining
to call it a bargain is honest; hiding it — which is what the app did until
today — is not.
