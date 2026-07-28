# Printed menu prices — changes still needed in Clover

The app now shows the **printed menu price**. Clover has not been changed, and
**Clover is what actually charges the customer.**

Until the list below is entered in the Clover dashboard, the app and the counter
disagree on these items. Two consequences, in opposite directions:

- On the seven items where Clover is **cheaper**, a customer sees the menu price
  in the app and is charged the lower Clover price. You lose the difference.
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
