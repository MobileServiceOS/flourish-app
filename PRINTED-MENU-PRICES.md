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
