# What the new earning paths could cost

Written before any of it shipped, from the live register rather than from
guesses. Five new ways to earn Petals without placing an app order: a counter
receipt, a signup bonus, a birthday, a referral, and a staff-granted Perks
match.

**Read the last section first if you read nothing else.** The referral is the
only path with no ceiling on it, and the receipt claim is the only one an
attacker can turn into money at scale.

---

## The two numbers everything below is built on

**A Petal is worth 5.0c**, at every rung of the reward ladder except one.

| reward | cost | cap | cents per Petal |
|---|---|---|---|
| Free drink | 70 | $3.50 | 5.0 |
| $5 off | 100 | $5.00 | 5.0 |
| Free side | 120 | $6.00 | 5.0 |
| Free seafood mac | 160 | $8.00 | 5.0 |
| Free lunch | 250 | $12.50 | 5.0 |
| **Free plate** | **350** | **$20.00** | **5.71** |

A customer maximising value takes plates, so **every worst case below is priced
at 5.71c** and every "typical" figure at 5.0c. The gap is 14%, which is not
nothing when the totals reach five figures.

**Measured from the register on 13 September 2026:**

| | |
|---|---|
| orders in the last 90 days | 8,911 |
| orders in the last 7 days | 741 |
| average order, pre-tax and pre-tip | **$21.58** |
| median order | $17.50 |
| Petals an average counter order earns | **22** |
| enrolled Perks customers | 670 |

---

## What one customer can earn without spending anything

Honest, and taking everything on offer:

| | Petals | at 5c | at 5.71c |
|---|---|---|---|
| Signup bonus, once ever | 50 | $2.50 | $2.86 |
| Perks match, once ever, staff-granted | 200 | $10.00 | $11.43 |
| Birthday, **every year** | 350 | $17.50 | $20.00 |
| **First year total** | **600** | **$30.00** | **$34.29** |
| Every year after | 350 | $17.50 | $20.00 |

Nothing in that column requires them to buy anything, and the birthday repeats
annually. **$34.29 in year one, $20 a year thereafter, per customer, floor.**

Then the two that are not bounded that way:

**Referrals — no ceiling exists.** 100 Petals per friend brought, and a
referrer can bring any number. Twenty friends is 2,000 Petals, $114. The
friends have to be real people who each pay for a real order, so it is not free
money — but it is unbounded, and it is the one number in this document with no
maximum. **See the recommendation at the end.**

**Receipt claims — real money, if farmed.** Bounded only by the rate limit.

---

## The receipt claim is the fraud surface

A printed receipt does not say who paid. There is no way to authenticate the
claimant, so the claim can only be made once-only per order and rate-limited.
Somebody lifting receipts off the counter, or out of the bin, passes every
other check: the orders are real, paid, recent and unclaimed.

| | claims/day | Petals/week | per year | at 5.71c |
|---|---|---|---|---|
| **No rate limit** — every counter order claimed | 106 | 15,991 | 831,532 | **$47,481** |
| **3/day** (what shipped) | 3 | 462 | 24,090 | **$1,376** |
| 1/day | 1 | 154 | 8,030 | $459 |

The unlimited row is not hypothetical: 741 orders a week at 22 Petals each is
what the shop actually turns. **The rate limit is the single most valuable
control in this whole feature set** — it is the difference between $1,376 and
$47,481 of annual exposure to one determined person.

Three a day was chosen because a genuine customer eating there every day is
unaffected, and because it caps a farmer at roughly one average order's worth
of Petals per day.

Two things bound it further, both already enforced:

- **Once per order, ever, by anyone.** The ledger key is the Clover order id
  with no customer in it, so the second person to claim a receipt gets nothing.
- **Seven days.** An old receipt is worthless, so a stack kept for months is
  worthless.

---

## All 670 Perks customers, claiming everything

The theoretical maximum, if every enrolled customer downloads the app and takes
every reward available.

| | Petals | at 5c | at 5.71c |
|---|---|---|---|
| Perks match, 670 × 200 | 134,000 | $6,700 | $7,657 |
| Signup bonus, 670 × 50 | 33,500 | $1,675 | $1,914 |
| **One-time subtotal** | **167,500** | **$8,375** | **$9,571** |
| Birthday, 670 × 350, **per year** | 234,500 | $11,725 | $13,400 |
| Referral, if each brings one friend (both sides) | 134,000 | $6,700 | $7,657 |
| **Year one, everything** | **536,000** | **$26,800** | **$30,629** |

Your own figure of **$6,700 for the Perks match at full take-up is confirmed**
— that is the 5c row. At the plate rate it is $7,657.

**Year one worst case is $30,629. Recurring worst case is $13,400 a year**, from
the birthday alone.

---

## What take-up realistically looks like

Everything above assumes 100% of 670 customers do everything. That will not
happen, and it is worth being clear about which parts of this are measured and
which are judgement.

**Measured:** the order volume, the average order value, the 670 count, the
Petal values. Those are facts.

**Judgement, and it is only that:** the 670 are a warm list — they opted into
loyalty once already, by texting a code at the counter. But the app asks for
more than a text did: find it in the App Store, download it, create an account.
Published conversion from an engaged restaurant loyalty base to an app install
generally lands somewhere around 15–25%, and I have no data specific to this
shop. **Treat the middle of that range as a planning number, not a forecast.**

At 20% (134 customers), with 60% supplying an optional birth date and 15%
referring one friend:

| | Petals | at 5c |
|---|---|---|
| Perks match, 134 × 200 | 26,800 | $1,340 |
| Signup, 134 × 50 | 6,700 | $335 |
| Birthday, 80 × 350/year | 28,000 | $1,400/yr |
| Referral, 20 × 200 | 4,000 | $200 |
| **Year one** | **65,500** | **$3,275** |

So the realistic figure is around **$3,275 in year one against a $30,629
theoretical ceiling** — roughly a tenth.

**Two things make the real cost lower still, and one makes it higher.**

Lower: *breakage.* A substantial share of loyalty currency is never redeemed —
people forget, move away, or never reach a threshold. And a redeemed Petal is a
discount on food, not cash out of the till: $1 of discount costs the kitchen its
food cost, not $1, unless the customer would have bought anyway.

Higher: *the birthday recurs.* It is the only line here that repeats every year
per customer, and it is the largest per-customer item. At full take-up it alone
is $13,400 a year, indefinitely.

---

## The signup bonus, once it applies retroactively

The bonus fires on **first server-side appearance of a phone number**, not on
account creation. That is one mechanism covering three populations, and it
changes the exposure in two ways worth stating separately.

### It is the same 50 Petals, reaching more people

| population | how they get it | when |
|---|---|---|
| New customers signing up | the live path | at signup |
| Customers already in the ledger | the backfill, `--run` | when you run it |
| Customers whose account exists only on their phone | the live path | first time they open the updated app |
| Customers staff enrol via a Perks match | the match itself | at the counter |

**The ceiling does not move.** The liability was always counted as "670 × 50 =
33,500 Petals, $1,675" — one bonus per customer. Making it retroactive does not
create a 671st customer; it changes *when* the existing ones are paid and
guarantees nobody is skipped for having joined early.

**What does move is the timing.** Instead of trickling out as customers sign
up, the backfill mints the whole of group 1 in one run. Run the dry run first
and you will know the exact figure before a single Petal exists:

```
node scripts/petals-backfill-signup.mjs          # dry run, writes nothing
node scripts/petals-backfill-signup.mjs --run
```

### A matched Perks customer is now worth 250, not 200

The one genuine increase. A Perks match is often the first time a number
reaches the server, so the match now pays the signup bonus alongside it:

| | Petals | at 5c |
|---|---|---|
| Perks match | 200 | $10.00 |
| Signup bonus, same moment | 50 | $2.50 |
| **Per matched customer** | **250** | **$12.50** |
| All 670 matched | 167,500 | **$8,375** |

That $8,375 is the same "one-time subtotal" already in the table above — the
two lines have simply merged into one event. Nothing new is created; it is paid
earlier and in one place, which is easier to reason about, not more expensive.

### Admin corrections are deliberately excluded

`/petals/adjust` is the one path that creates customers and does **not** pay the
bonus. A correction that silently added 50 would be larger than whoever
authorised it typed, and — the case that settled it — a *negative* correction
against an unknown number would partially cancel itself: clawing back 200 would
leave the customer on −150 rather than −200, and nobody would notice until the
arithmetic was questioned. Nobody is missed by the exclusion, because the
backfill sweeps up anyone an adjustment created.

### How many would be credited today

**Unknown from here, and that is a real gap rather than an estimate I am
withholding.** Railway's Postgres is on an internal hostname with no public
proxy, and the CLI tunnel is blocked in this environment, so I could not count
the rows. The dry run answers it exactly, from the host, without minting
anything — and prints the dollar figure alongside the count.

The upper bound is knowable regardless: the ledger cannot hold more customers
than have ever transacted, so **the backfill cannot cost more than 670 × 50 =
33,500 Petals ($1,675)** even if every Perks customer were already in it. In
practice it will be far lower, because server-side Petals are recent and only
customers who have used the app since are in the table at all.

## The one recommendation before this ships

**Cap referrals per customer per year.** Every other path has a ceiling:

| path | ceiling |
|---|---|
| Signup | once per phone, ever |
| Perks match | once per phone, ever, and never above 200 |
| Birthday | once per calendar year |
| Receipt claim | once per order, 3 a day, 7-day window |
| **Referral** | **none** |

Nothing stops one person referring two hundred people. Each referral needs a
real friend paying for a real order, so it is far from free — but "20 a year" or
"1,000 Petals a year from referrals" would bound the one open-ended number here,
and can be added with the same idem-key shape as everything else.

It was not built because it was not asked for, and adding a cap nobody asked for
to a promotion is a commercial decision rather than a technical one. It is the
first thing worth deciding.

---

## Where any balance came from

Every one of these writes a ledger row with a reason, so a balance can be taken
apart months later at a counter:

| reason | key | once |
|---|---|---|
| `signup` | `signup:<phone>` | per phone, ever |
| `receipt` | `receipt:<cloverOrderId>` | per order, ever, by anyone |
| `birthday` | `birthday:<phone>:<year>` | per phone per calendar year |
| `referral` | `referral-referee:<phone>` / `referral-referrer:<phone>` | per referred person |
| `perks match` | `perks:<phone>` | per phone, ever |

The referrer's key is the **referee's** phone, which is what lets a referrer
earn once per friend rather than once in their life.
