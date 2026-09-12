# Audit: every hide/delist reason, checked against live Clover

Prompted by the Blue Crab entry, whose comment read like a reason and was a
guess — and backwards. This checks all 21 declarations in
`scripts/generate-menu.mjs` against the live register.

**Audited 2026-09-11** against `api.clover.com`, merchant `W2K2XR2X54VV1`:
all 124 items, all 31 modifier groups, and **600 recent orders** (630 line
items) for sales evidence.

## How each was judged

Most of these reasons are claims about **the printed menu** or **what the
kitchen still cooks**. Clover records neither, so those cannot be confirmed from
the API — that is *unverifiable*, not *wrong*.

What Clover does record is whether a thing **still sells**, and that is the
sharpest test available. An item hidden as "no longer offered" that sold
fifteen times last month is a reason that has stopped being true.

## Headline

| | Count |
|---|---|
| Verified | 3 |
| **Wrong** | **2** |
| Unverifiable, and **still selling** — hiding these costs orders | **6** |
| Unverifiable, zero sales — consistent with the reason | 2 |
| **No reason stated at all** | **8** |

**8 of 21 carry no reason** — just the item's name. Those are not guesses so
much as undocumented decisions, and one of them is still selling.

---

## Wrong

### `49BD3KVSBHXRR` — Curry Chicken
> stated: *"sold only as the $8 lunch special"*

**The item sold 15 times in 600 orders, in its own right.** It is not only sold
as the lunch special. Live at **$0.00**, so those 15 sales rang the price from a
modifier — but the claim that it is not sold as itself is contradicted.

Separately: a $0.00 base is a free-plate risk if it is ever un-delisted. That
belongs in CLOVER-FIXES.

### `KR1HHY64E4QPJ::Seafood` — Seafood in the Stew Peas size group
> stated: *"sold as its own item, Fri & Sat only"*

The structural half is **verified**: the $30 modifier exists, and so does the
standalone `32VDQ4G5J131P` at $30. The **day is stale** — the shop corrected
that dish to **Fridays only**. Zero sales through the modifier, so the hide is
working.

---

## Verified

| Entry | Reason | Evidence |
|---|---|---|
| `PSGB77QNZR2WM` Blue Crab $20 | duplicate; flyer lists $15 | $20 live in Lunch & Dinner; `DH0P3NGRN9RNE` $15 in Seafood Fridays. Flyer says $15. **But the $20 one is the one being rung** — 1 sale — so the register has been charging $5 over the flyer |
| `H2749PVKFN4EY::Medium Goat` | counter only, not the app | Your instruction; $0.00 live; 0 sales through the app's path |
| `H2749PVKFN4EY::Large Goat` | counter only, not the app | as above |

---

## Unverifiable — and still selling

The reason may well be true; the API cannot say. What it *can* say is that these
are moving, so hiding them from the app is turning away orders.

| Entry | Stated reason | Sales in 600 orders |
|---|---|---|
| `F0Q8615QD5HMM::Wings` | lunch specials the menu does not list | **185** |
| `ZR29AF0E4JPXA::Jerk` | salmon flavours the menu does not list | **25** |
| `F0Q8615QD5HMM::Curry Goat` | lunch specials the menu does not list | **12** |
| `F0Q8615QD5HMM::Oxtail` | lunch specials the menu does not list | **8** |
| `AJY3FTT4BRPHP::Whiting Fish` | $14 full meal, not a listed dish | 1 |
| `AJY3FTT4BRPHP::Snapper Fish (Add On. No Sides)` | menu lists fish at $30 only | 1 |

**Wings at 185 sales is the single most-ordered lunch special in the sample** and
the app will not sell it. Whatever the printed menu says, that is worth a
decision rather than an inherited exclusion.

The price claim on Whiting Fish checks out exactly: **$14.00** live.

---

## Unverifiable, zero sales

Consistent with the stated reason. Nothing to act on.

| Entry | Stated reason |
|---|---|
| `NH99VMKKGJ572` Baked Chicken | no longer offered |
| `ZR29AF0E4JPXA::Steamed` | salmon flavours the menu does not list |

---

## No reason stated at all

Eight entries carry only the item's name. All exist live.

| Entry | Live | Sales |
|---|---|---|
| `S0GK9MD2NE414` Salmon (1 Piece) | $15.00 | **5 — still selling** |
| `YQH6NFFB34SVM` BBQ Chicken | **$0.00** | 0 |
| `21RNMJ880YCMC` Crab Legs & Shrimp | $39.99, in Seafood Fridays | 0 |
| `PEB98GZ1MBF6P` Lobster Tail (No Meal) | $25.00 | 0 |
| `K7EX5APPAXPEJ` Lobster Roll & Fries | $20.00, in Seafood Fridays | 0 |
| `PZ1FB6X44MGYE` Lex Special | $40.00 | 0 |
| `QDCGERYM91BP0` Beef Patty | $3.00 | 0 |
| `Y79KKCYGMHRB6` Chicken Patty | $3.00 | 0 |

Seven of the eight have no sales, so the exclusions look right even undocumented.
**Salmon (1 Piece) is the exception** and needs a decision.

`YQH6NFFB34SVM` BBQ Chicken is **$0.00** in Clover — a free plate if it is ever
un-delisted. Worth fixing at the register regardless.

---

## What to do

Nothing here has been changed. Three groups:

**Decide, then act (app-side once decided)**
1. **Wings** — 185 sales and the app will not sell it. Is it on the menu?
2. **Jerk salmon** (25), **Curry Goat** (12), **Oxtail** lunch special (8).
3. **Salmon (1 Piece)** — 5 sales, delisted with no reason.
4. **Curry Chicken** — the reason is wrong whatever you decide.

**Fix at the register**
5. `YQH6NFFB34SVM` BBQ Chicken and `49BD3KVSBHXRR` Curry Chicken both **$0.00**.
6. Hide `PSGB77QNZR2WM` Blue Crab $20 — and note the register has been ringing
   it, so walk-ins have been paying $20 against a $15 flyer.

**Housekeeping, app-side**
7. Correct the `KR1HHY64E4QPJ::Seafood` reason to "Fridays only".
8. Give the eight bare entries a reason, or drop them. An exclusion nobody can
   explain is the thing that made this audit necessary.

## A note on the method

The first version of the extraction script reported
`"4BY3GKC2SVJ90::Fried"` as an active exclusion. It is not — it appears inside a
comment explaining why it was **removed**, and the regex matched the quoted
string without its context. Same error class as the audit's subject, so the
script strips block comments before matching.


---

## Update — acted on, and one reversal (2026-09-11)

**The $20 Blue Crab is back.** `PSGB77QNZR2WM` was delisted on the reading that
Blue Crab was duplicated in Clover and the flyer's $15 settled it. Confirmed
with the owner: it is not a duplicate. `DH0P3NGRN9RNE` at $15 is the **Friday**
price, in Seafood Fridays with the Friday lock; `PSGB77QNZR2WM` at $20 is the
**everyday** one in Lunch & Dinner with no lock. Both are live and both are
correct — two prices for two different days, which is the one shape the app can
express without day-dependent pricing.

Worth recording how this went wrong twice in opposite directions. First the $15
was delisted as a stray, then the $20 was. Neither was ever a duplicate. Both
guesses came from reading two rows with one name as an error rather than asking
which it was — the same root cause this whole audit was written about.

The everyday Blue Crab also has `Side With Meal` correctly attached, which the
Friday one does not (CLOVER-FIXES.md §10).

**Goat soup**: the two sizes are no longer hidden, they are deleted at the
register. The `HIDDEN_IN_APP` entries for them dangled after the regeneration
and the generator's stale-key warning caught both.

**Still hidden for a pricing reason, unchanged**: BBQ Chicken
(`YQH6NFFB34SVM`) and Curry Chicken (`49BD3KVSBHXRR`), both $0.00 in Clover and
both would ring free.
