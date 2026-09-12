# Uber Eats comparison — every claim, for spot-checking

The savings line is the most checkable thing in the app: a customer can open
Uber Eats and see in ten seconds whether we told the truth. A number that is
wrong or ambiguous costs more trust than the badge ever earned.

**Nobody has ever verified these.** The generator carried the comment
"re-check these occasionally" and no re-check happened. This page exists so a
spot-check is possible without reading code.

---

## What the app shows today

Three items, all one-price dishes, where the comparison is unambiguous:

| Dish | Ours | Uber Eats | Claim shown |
|---|---|---|---|
| Lamb | $30.00 | $36.00 | "Uber Eats: $36.00 — you save $6.00 ordering direct" |
| Salmon | $22.00 | $24.00 | "Uber Eats: $24.00 — you save $2.00 ordering direct" |
| Shrimp | $20.00 | $24.00 | "Uber Eats: $24.00 — you save $4.00 ordering direct" |

**Check these three first.** They are the only numbers a customer can currently
be shown, so they are the only ones that can currently be wrong.

---

## Five items show nothing, and why

These have an Uber price on record, but it is a **single number against a dish
we sell in two sizes** — so it cannot say which of our sizes it corresponds to.

| Dish | Ours | Uber Eats | What the old badge claimed | The problem |
|---|---|---|---|---|
| Oxtail | Med $20.00 · Lg $25.00 | $24.00 | SAVE $4.00 | our **Large is $1.00 DEARER** than Uber |
| Fried Chicken | Med $13.00 · Lg $16.00 | $15.60 | SAVE $2.60 | our **Large is 40c dearer** |
| Curried Goat | Med $15.00 · Lg $18.00 | $18.00 | SAVE $3.00 | level at the Large — no saving at all |
| Wings | Med $15.00 · Lg $18.00 | $18.00 | SAVE $3.00 | level at the Large |
| Jerk Chicken | Med $14.00 · Lg $16.00 | $16.80 | SAVE $2.80 | 80c at the Large, not $2.80 |

The old badge took the **cheaper** size every time, then sat under both prices.
On Oxtail — the flagship dish — it advertised $4.00 off while the large plate
cost a dollar more than the same thing on Uber.

### How to bring them back

Price each size on Uber and change the entry in `scripts/generate-menu.mjs`
from a number to a pair:

```js
"60KCQ1V22Q98M": { med: 24, lg: 27 },   // Oxtail
```

The comparison then renders per size, against the price beside it, and drops
any size where Uber is actually cheaper. The mechanism is built and tested —
it needs the numbers, not code.

The generator lists every ambiguous entry on each run, so this cannot be
quietly forgotten again.

---

## When you re-check, record it

Add the date here. "Verified by hand" with no date is what produced a page of
unchecked numbers.

| Date | Checked by | Notes |
|---|---|---|
| — | — | never verified |
