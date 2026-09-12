# Printed menu prices — changes still needed in Clover

The app now shows the **printed menu price**. Clover has not been changed, and
**Clover is what actually charges the customer.**

Until the list below is entered in the Clover dashboard, the app and the counter
disagree on these items. Two consequences, in opposite directions:

- On the items where Clover is **cheaper**, a customer sees the menu price in the
  app and is charged the lower Clover price. You lose the difference. The two
  Side With Meal upcharges were the worst of these — $0.00 in the register,
  riding on 19 different plates — and they have now been fixed at the source.
- On the two items where Clover is **dearer**, a customer sees the lower menu
  price and is charged more. **That one generates complaints** — it is the
  reason to do this sooner rather than later.

Everything here is also on Ordering Tools and any delivery platform syncing your
inventory, so fixing it in Clover fixes it everywhere at once.

---

## Raise these — you are undercharging

### Pork
Modifier Groups → **Pork** (`907Z8BF726CQ4`)

| Option | Clover now | Set to |
|---|---|---|
| Medium Stew | $14.00 | **$20.00** |
| Large Stew | $17.00 | **$25.00** |
| Medium Jerk | $15.00 | **$20.00** |
| Large Jerk | $20.00 | **$25.00** |

This is the expensive one — $5 to $8 on every pork plate you sell.

### Pasta
Modifier Groups → **Pasta** (`D0F1SFXHWSQWT`)

| Option | Clover now | Set to |
|---|---|---|
| Penne Alla Vodka | $15.00 | **$18.00** |

### Sides
Modifier Groups → **Side** (`S032100JQ3P4T`)

| Option | Clover now | Set to |
|---|---|---|
| Chicken Mac & Cheese | $6.99 | **$7.00** |

### Sides that come with a plate — DONE

Modifier Groups → **Side With Meal** (`YQWN3PKBKV9NG`)

| Option | Was | Now in Clover |
|---|---|---|
| Fried Chicken (`W63ZR0Q92XER4`) | $0.00 | **$6.00** ✅ |
| Whiting Fish X1 (`WHGNBP3G67PJP`) | $0.00 | **$2.50** ✅ |

This was the largest leak on the page and it is closed. Both were $0.00, so the
counter charged nothing for them on any of the 19 plates sharing the group while
the app showed the upcharge — the customer saw a total *higher* than they paid,
which is why nobody ever complained and it went unnoticed for so long.

The app follows Clover on both now, so the two agree and neither map is an
override any more.

**One thing did not land where it was intended.** Whiting Fish X1 was meant to go
to **$3.00** in this group. The $3.00 was applied to the *standalone* `Side`
group instead (`S032100JQ3P4T`, "Whiting Fish  X1" — note the double space),
which went $2.50 → $3.00; the meal group was set to $2.50. Both are now
internally consistent, so nothing is mischarged either way, and the app quotes
$2.50 with a plate because that is what the register takes.

If $3.00 with a plate is what you want, it is one field:
Side With Meal → Whiting Fish X1 → $3.00. The app picks it up on the next
regeneration with no code change.

### Lunch specials
Modifier Groups → **Lunch Specials** (`F0Q8615QD5HMM`)

| Option | Clover now | Set to |
|---|---|---|
| Curried Chicken | $7.99 | **$8.00** |
| Fried Chicken | $7.99 | **$8.00** |
| Jerk Chicken | $7.99 | **$8.00** |
| Stew Chicken | $7.99 | **$8.00** |

---

## Lower these — you are overcharging against your own menu

### Pasta
Modifier Groups → **Pasta** (`D0F1SFXHWSQWT`)

| Option | Clover now | Set to |
|---|---|---|
| Oxtail | $25.00 | **$24.00** |

### Chicken & Waffles
Items → **Chicken & Waffles** (`1PBGJ1BWC3Z52`)

| | Clover now | Set to |
|---|---|---|
| Item price | $15.99 | **$15.00** |

---

## Hide these — sold on the register, not on the printed menu

They are already hidden in the app. They can still be rung up at the counter.

| Where | Option | Price |
|---|---|---|
| Modifier Groups → Fish (`AJY3FTT4BRPHP`) | Whiting Fish | $14.00 |
| Modifier Groups → Lunch Specials (`F0Q8615QD5HMM`) | Curry Goat | $12.00 |
| Modifier Groups → Lunch Specials (`F0Q8615QD5HMM`) | Oxtail | $13.50 |
| Modifier Groups → Lunch Specials (`F0Q8615QD5HMM`) | Wings | $10.50 |

If any of these *should* be sold, the fix is the other way round: put them on
the printed menu and take them out of `NOT_ON_PRINTED_MENU` in
`scripts/generate-menu.mjs`.

---

## From the printed trifold (photographed 28 Jul 2026)

### Goat head soup was unsellable

Modifier Groups → **Soup** (`H2749PVKFN4EY`)

| Option | Clover now | Set to |
|---|---|---|
| Medium Goat | **$0.00** | **$5.00** |
| Large Goat | **$0.00** | **$10.00** |

Both were priced $0, so the app hid them rather than give the dish away. The menu
prices them $5 / $10 and they are now on sale in the app. **Until Clover is fixed
they still ring up free at the counter.**

### More options the menu does not list

Already hidden in the app, still sellable on the register:

| Where | Option | Price |
|---|---|---|
| Fish (`AJY3FTT4BRPHP`) | Snapper Fish (Add On. No Sides) | $20.00 |
| Salmon (`ZR29AF0E4JPXA`) | Steamed | $22.00 |
| Salmon (`ZR29AF0E4JPXA`) | Jerk | $22.00 |
| Shrimp (`4BY3GKC2SVJ90`) | Fried | $20.00 |

Fish is now the flat **$30** the menu prints.

### Needs creating in Clover — the app cannot add these

The menu sells things Clover has no record of, and an order line needs a real
Clover modifier id, so these cannot be added from this end:

| Where | Missing | Menu price |
|---|---|---|
| Salmon (`ZR29AF0E4JPXA`) | **Pepper** | $20 |
| Salmon (`ZR29AF0E4JPXA`) | **Garlic** | $20 |
| Salmon (`ZR29AF0E4JPXA`) | **Curry** | $20 |
| Pork Ribs (`433FBT50JEVY8`) | a size group — menu is **$15 / $18**, Clover is flat **$18** | |

Until they exist in Clover, the app sells salmon in three flavours instead of
six, and pork ribs at one size instead of two.

---

## Items delisted from the app

Not on the printed menu, so no longer sold in the app. Still live on the
register — hide them in Clover too if they are genuinely off.

BBQ Chicken · Curry Chicken (sold only as the $8 lunch special) ·
Crab Legs & Shrimp · Lobster Tail (No Meal) · Lobster Roll & Fries ·
Pepper Shrimp & Mussels · Salmon (1 Piece) · Lex Special ·
Blue Crab $15 (a duplicate — the menu lists one at $20) ·
Beef Patty · Chicken Patty

**Kept despite not being on the trifold**, by instruction: the five Seafood
Fridays platters, both drinks, Ackee & Shrimp, and Seafood Stew Peas.

---

## Left alone on purpose

**Salmon — $22.** Clover and the printed menu agree on the price, so nothing
changed.

Their **flavour lists** do not agree, and nobody has said which is right:

| Clover sells | Printed menu lists |
|---|---|
| Sweet Chili | Sweet Chili |
| Grilled | Grilled |
| Honey Garlic | Honey Garlic |
| Steamed | Pepper |
| Jerk | Garlic |
| — | Curry |

So the app currently offers Steamed and Jerk salmon, and does not offer Pepper,
Garlic or Curry at all. Say which list is correct and it is a one-line change.

---

## After you make the changes

Export the inventory again and regenerate:

```bash
npm run menu -- ~/Downloads/inventory-export.xlsx
```

The script prints this same list every run, comparing the export against the
printed-menu maps at the top of `scripts/generate-menu.mjs`. **When it prints
nothing, Clover and the app agree** and this file can be deleted.


---

## Every override, checked against LIVE CLOVER (2026-09-12)

"The printed menu wins" stopped being safe as a blanket rule the moment the
register started being corrected: for anything already fixed at the source, the
printed menu is now the OLDER document, and an override built from it drags the
app back to a stale number.

So each one was checked against `api.clover.com` — not the printed menu, not the
export. Source for every row below: a live `GET /v3/merchants/{mId}/modifier_groups/{gid}?expand=modifiers`.

| Override | Printed menu | **Live Clover** | Verdict |
|---|---|---|---|
| Side With Meal → Whiting Fish X1 | $2.50 | **$3.00** | **STALE — removed.** Register was corrected; the override was pulling the app *below* the till |
| Pork → Medium Stew | $20 | $14 | override still needed — register unchanged |
| Pork → Large Stew | $25 | $17 | override still needed |
| Pork → Medium Jerk | $20 | $15 | override still needed |
| Pork → Large Jerk | $25 | $20 | override still needed |
| Pasta → Penne Alla Vodka | $18 | $15 | override still needed |
| Pasta → Oxtail | $24 | **$25** | **app quotes BELOW the register — decide** |
| Side → Chicken Mac & Cheese | $7.00 | $6.99 | override still needed (1c) |
| Lunch Specials → Curried/Fried/Jerk/Stew Chicken | $8.00 | $7.99 | override still needed (1c) |
| Chicken & Waffles (item price) | $15.00 | **$15.99** | **app quotes BELOW the register — decide** |
| Side With Meal → Fried Chicken | $6.00 | $6.00 | matches; kept as an assertion, applies nothing |
| Side With Meal → Shrimp | $5.00 | $5.00 | matches; assertion only |
| Side With Meal → Seafood Mac | $3.50 | $3.50 | matches; assertion only |

### Only one was stale

Whiting. The register moved to $3.00 and the override kept forcing $2.50 — which
the generator reported as twenty-odd `lower ... 3 -> 2.5` lines, one per plate
sharing the group. Every one of those would have quoted a customer 50c under
what the till takes. **That is the complaint-generating direction**, and it was
created by leaving a number here after fixing it at the source.

Note the key was **not deleted**. Any side not named in `SIDE_UPCHARGE` is
asserted to be $0.00, so removing Whiting would make its legitimate $3.00 report
as a pricing fault on every run. It stays at the register's number, as an
assertion.

### The rest are not stale — they are the original divergence, still open

Pork, Pasta Penne, Chicken Mac and the four Lunch Specials plates read low in
Clover because **the register has not been changed for them**. Deleting those
overrides would make the app quote $14 for a pork plate the printed menu sells
at $20 — undercutting the shop's own menu. They stay until the dashboard is
updated, which is what the rest of this document is for.

### Two need a decision, not a code change

**Pasta → Oxtail** ($24 app / $25 register) and **Chicken & Waffles** ($15 app /
$15.99 register) are the two where the app quotes **less** than the till. Same
harmful direction as Whiting, and both predate it. Either:

- the printed menu is right → change the register to $24 and $15, and these
  overrides become assertions like Whiting's, or
- the register is right → delete both overrides and the app follows.

Whichever, the app and the counter should stop disagreeing on two items where the
customer notices.
