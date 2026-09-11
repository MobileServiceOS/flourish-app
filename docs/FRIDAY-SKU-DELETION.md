# Deleting the Friday duplicates — read this before you delete

You decided: delete the Friday SKUs, make Friday a price difference on the
everyday items. Zero sales, no modifier groups, and the counter already works
that way.

**Two things to settle first**, because one of them cannot be undone by editing
the app.

---

## 1. Three of the eight are not duplicates

Deleting these removes the dish from the register entirely. Nothing else sells
them.

| Item | Price | Twin elsewhere? |
|---|---|---|
| `32VDQ4G5J131P` Seafood Stew Peas | $30.00 | **none** |
| `DH0P3NGRN9RNE` Blue Crab | $15.00 | only the $20 one you are already hiding |
| `PH221AJ7W66EA` Pepper Shrimp & Mussels | $17.00 | **none** |

**Keep all three.** They stay in Seafood Fridays, Friday-locked, exactly as they
are now. Only five items are actually duplicates.

---

## 2. There is no mechanism for a Friday price. Not in the app, not in Clover.

This is the part worth knowing before anything is deleted.

The app **sends no line prices** — Clover prices its own orders, which is rule 2
in `CLAUDE.md` and the reason the till and the app can never disagree about
money. So a Friday price has to exist *in Clover*.

Clover's inventory model has no scheduled or day-dependent item pricing. There
is no field for it, and nothing in the API exposes one. The app has day locks
for **availability** — they decide whether something can be ordered today, not
what it costs.

So once the five Friday SKUs are gone, **there is no automatic way to charge a
Friday price**, in the app or at the register. The Friday SKUs *were* the
mechanism: a second item at a second price, which is why they exist.

### And the prices are not a consistent discount

Measured against live Clover:

| Friday SKU | Friday | Everyday twin | Everyday | Difference |
|---|---|---|---|---|
| Crab Legs Platter | $39.99 | Crab Legs Platter `598S0BJH4J7DE` | $50.00 | **$10.01 cheaper** |
| Lobster Platter | $39.99 | Lobster `VGZYVZCB2NCRY` | $45.00 | **$5.01 cheaper** |
| Salmon | $21.99 | Salmon `H9520PFNBT2NY` | $22.00 | $0.01 cheaper |
| Shrimp | $21.99 | Shrimp `VHHCS7EDV70HC` | $20.00 | **$1.99 DEARER** |
| Fish Platter | $30.00 | Snapper Fish `VQZ0T4XK707EC` | $30.00 in the app | same |

Two are real Friday discounts. One is *dearer* on Friday. Two are the same to
within a cent. So "Friday is a price difference" is only true of crab legs and
lobster — and those two are the ones where the gap is worth protecting.

The gap is wider than the table suggests: the Friday platters **include shrimp**,
where the everyday items charge $5.00 for it as a side. Crab legs with shrimp is
$55.00 on an ordinary day against $39.99 on the flyer.

---

## What I would do

**Delete three, keep two.**

Delete the ones where Friday buys nothing:

| Delete | Because |
|---|---|
| `06Z80836S0GZR` Fish Platter (Shrimp & 2 Sides) | same price as Snapper Fish, which has flavours and sides |
| `0NQ5E11VABFDY` Salmon (Shrimp & 2 Sides) | one cent apart from Salmon, which has flavours and sides |
| `CAFAH5FKPTRW8` Shrimp | *dearer* than the everyday Shrimp, which has flavours and sides |

Keep the two carrying a real discount, and give them the groups they are
missing so they can actually be sold:

| Keep | Attach | Why |
|---|---|---|
| `BRMP82TR0Z45C` Crab Legs Platter (Shrimp & 2 Sides) | `Side With Meal` | $10.01 below the everyday item, $15 below it with shrimp |
| `A1YZ2ZD5CA1SW` Lobster Platter (Shrimp & 2 Sides) | `Side With Meal` | $5.01 below the everyday item |

That keeps the Friday promotion where it is real, drops the three duplicates
that were only ever confusing, and needs no mechanism that does not exist.

**If you would rather delete all five**, that is fine and simpler — but then say
which everyday price you want all week for crab legs and lobster, because the
$39.99 will otherwise not exist anywhere. The options are: lower the everyday
item to $39.99 permanently, leave it at $50 and lose the Friday deal, or have
staff apply a manual discount on Fridays, which the app cannot do and cannot
show.

---

## What happens in the app either way

Nothing needs building.

- Deleted items: add their ids to `DELISTED` in `scripts/generate-menu.mjs`,
  with a reason — the audit found 8 entries with none, so let us not add more.
  They vanish from the app on the next regeneration. Zero sales, so no customer
  notices.
- `Side With Meal` attached to a kept item: sides appear automatically, priced
  by the `SIDE_UPCHARGE` rules already in place. No code change.
- The everyday items already sell all week with their flavours and sides, so the
  dishes on the flyer remain orderable whatever you delete.
- `Seafood Fridays` shrinks to the three genuinely Friday-only dishes, plus
  whichever platters you keep. The category's Friday lock is unaffected.

**Nothing in this document has been applied.** Tell me which option and I will
make the app match, after you have changed the register.
