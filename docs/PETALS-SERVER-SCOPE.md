# Server-side Petals — written scope

**Status: scope only. No code written. Decisions needed at the end before I build.**

Today a Petals balance lives in one JSON blob on the customer's phone
(`flourish:account`, `src/lib/storage.js`). Nothing on the server knows it
exists. That was defensible while the app was a side channel. It stops being
defensible the moment the restaurant tells every customer to download it:
a reinstall, a lost phone or a cleared browser wipes a balance with no record
anywhere, and the person who takes that complaint is staff at the counter with
nothing to look it up in.

This is what it takes to fix, what it protects, and what it does not.

---

## 1. What the server stores, and where

### Where: Postgres on Railway

The proxy has no database today. It is a stateless Express app, and everything
it holds in memory — the printer cache, the rate limiter, the idempotency
replay map — is explicitly documented as per-process and disposable.

A balance is not disposable, so this is the first thing in the project that
needs real storage. Railway Postgres sits next to the existing service, shares
its private network, and needs no new vendor, no new account and no new secret
management beyond one `DATABASE_URL` in the dashboard.

Alternatives considered and rejected: SQLite on a Railway volume (survives
deploys but not a region move, and makes running two instances impossible);
Clover's own customer metadata (there is no writable balance field, and every
loyalty endpoint answers 405); a hosted KV (no ledger, no transactions, and
this needs both).

### What: three tables

```sql
customer
  id            bigserial primary key
  phone         text unique not null      -- E.164, +1XXXXXXXXXX
  name          text not null
  clover_id     text                      -- mirrors the existing customer sync
  created_at    timestamptz not null default now()

ledger
  id            bigserial primary key
  customer_id   bigint not null references customer(id)
  delta         integer not null          -- +earned, -redeemed
  reason        text not null             -- earned|reserved|redeemed|released|reversed|adjusted
  order_id      text                      -- Clover order id, when there is one
  reward_id     text                      -- REWARDS id, on a redemption
  idem_key      text unique               -- what makes double-writes impossible
  created_at    timestamptz not null default now()

reservation
  id            bigserial primary key
  customer_id   bigint not null references customer(id)
  order_id      text unique not null      -- Clover order id
  reward_id     text not null
  petals        integer not null          -- what is held
  amount_cents  integer not null          -- the discount actually applied
  state         text not null             -- held|settled|released
  created_at    timestamptz not null default now()
  settled_at    timestamptz
```

**The ledger is the balance.** There is no mutable `petals` column, and that is
deliberate. Every question anyone will actually ask is historical — *why is my
balance 40 and not 90, was this reward already used, did that voided order give
my Petals back* — and a single integer cannot answer one of them. A balance
people dispute at a counter needs a trail. The current balance is
`SELECT COALESCE(SUM(delta),0) FROM ledger WHERE customer_id = $1`, which at
this volume (600 orders in the last sample period) is free; add a cached column
later if it ever stops being.

**`idem_key` unique is the real guard.** Double-crediting becomes structurally
impossible rather than carefully avoided — the same trick as the order
idempotency key already in `POST /orders`. Keys are deterministic:
`earn:<orderId>`, `reserve:<orderId>`, `settle:<orderId>`, `release:<orderId>`.
A second attempt to credit the same order violates the constraint and is
swallowed.

### Four endpoints

| | |
|---|---|
| `POST /api/clover/petals/balance` | `{ name, phone }` → `{ petals, tier, vouchers: [] }` |
| `POST /api/clover/orders` | gains `rewardId`; reserves inside the same transaction that creates the order |
| `GET /api/clover/orders/:id/status` | already exists — credits or settles as a side effect of the answer |
| `POST /api/clover/petals/claim` | `{ name, phone }` → binds this device to that balance |

Balance is a POST because it carries a phone number and must not sit in a URL,
a log line or a proxy cache.

---

## 2. Reserve on order, deduct on payment, release on void

You are right that this is broken today, and it is worth stating exactly how.
Petals are deducted the instant the customer taps redeem
(`App.jsx`, `setPoints(p => p - r.cost)`), and the voucher is consumed when the
order is created. So an order voided at the register costs the customer **both
the food and the Petals**, and nothing anywhere restores them. It is the mirror
image of the earning bug that was already fixed by gating on payment — spending
never got the same treatment.

The fix is the same shape as earning:

| Moment | What happens |
|---|---|
| taps redeem | **nothing is deducted.** The reward is a choice, not a spend |
| order created | `reservation` row `held`, ledger `-cost` with `reserve:<orderId>`. Balance drops, so it cannot be spent twice, but it is recoverable |
| Clover reports **paid** | reservation → `settled`. The ledger row already stands; this only closes the reservation |
| Clover reports **voided** | reservation → `released`, ledger `+cost` with `release:<orderId>`. The customer is whole again |

The balance a customer sees is the ledger sum, so a held reservation looks
spent while it is held. That is correct: they cannot spend it twice, and if the
order dies they get it back.

### The case you asked about: neither paid nor voided

A customer orders, reserves 120 Petals, and never comes back. Staff do not void
it — they just leave it. The order sits open in Clover forever and the
reservation sits `held` forever, so the Petals are gone with no event to release
them.

**Expire it.** A `held` reservation older than **24 hours** is released, on the
same schedule that the existing launch sweep already uses as its window. Two
ways to run it:

- **Lazily, on read** — every balance request first releases that customer's
  expired reservations. No scheduler, no new process, and the only person who
  cares is the customer looking at their balance. Self-healing.
- **A cron** — correct even for a customer who never opens the app again, but
  needs a Railway cron service and something to alert on when it stops.

I would do the lazy release, because it needs no new moving part and the
failure mode of a missed sweep is "a balance is stale until someone looks at
it", which resolves itself. Add the cron only if a report ever needs the
numbers to be right without a customer present.

One consequence to accept: a customer who orders, never collects, and comes
back within 24 hours sees their Petals still held. That is defensible — the
order is still live at the register and could still be paid.

---

## 3. Identity: name AND phone, no SMS

Your decision, and here is what it actually buys and costs, plainly.

**What it protects against:** a stranger who knows only a phone number. Phone
numbers are semi-public — they are on receipts, in contact lists, and guessable
in bulk. Requiring the name as well means a casual attacker holding a number
alone cannot claim the balance.

**What it does not protect against, and I want this in writing:**

- **Anyone who knows the customer.** A name and a phone number is what a
  friend, a family member, an ex or a colleague already has. This is not
  authentication; it is a speed bump against strangers.
- **Anyone holding a receipt or a ticket.** The kitchen ticket prints the
  customer's name and phone number, by design, because staff need them. A
  ticket out of the bin is a complete credential.
- **Bulk guessing.** Names are not high-entropy. The existing per-IP rate limit
  applies, but a patient attacker with a list of local numbers and common names
  will land some. Worth adding a per-phone attempt limit on `claim`.

**Worst case if it is abused:** someone claims a balance and spends up to one
reward — at most $22, and only by walking into the shop, ordering, and
collecting food in person, with the discount printed on a ticket a member of
staff hands over. That is a meaningfully small blast radius, which is why the
decision is reasonable. It is not, however, "secure", and it should not be
described as such to a customer.

**Mitigations worth having, none of which need SMS:** rate-limit `claim` per
phone (5 attempts an hour); log every successful claim with IP and timestamp so
a dispute has evidence; and when a claim moves a balance to a new device,
**invalidate the old device's session** so two phones cannot hold the same
balance — a claim is a move, not a copy.

---

## 4. Server unreachable

Your decision, implemented literally:

- **Ordering still works.** The app takes no money and the order is the thing
  that matters. Unchanged.
- **Redeeming does not.** The balance shows as unavailable, the reward list is
  disabled with a short reason, and the order goes through with no reward.
- **Never redeem against a cached balance.** A cached balance is the bug this
  whole document exists to remove — it is the device asserting money again,
  which is exactly what the discount fix stopped the client doing.

The one thing to get right in the UI: the customer must find out *before* they
reach checkout, not after they have committed to a reward. The reward list is
where the message goes.

---

## 5. Migrating the balances already on devices

This is the part with no clean answer, and the risk is double-counting: credit
the device balance, then also credit the order history it was derived from, and
everyone's balance doubles.

**The mechanism.** On first launch after the update, the app posts its local
balance once to `POST /petals/claim` with `{ name, phone, deviceBalance }`. The
server creates the customer, writes **one** ledger row —
`+deviceBalance, reason 'adjusted', idem_key 'migrate:<phone>'` — and returns
the server balance. The unique key means it can only ever happen once per
phone, however many times the app retries or however many devices try.

**Then the device balance stops being read, forever.** One line of code deletes
that path, and it is worth deleting rather than leaving dormant.

**What this accepts:** whatever the customer has in their own storage, once.
Someone who edited the JSON keeps what they typed. I think that is right — the
alternative is telling real customers their balance is gone because the app
could not prove it, and that costs more goodwill than the handful of people who
will bother to cheat $22. Log every migration row so the numbers are auditable
after the fact.

**Rejected alternative:** rebuilding balances from Clover order history. It
sounds rigorous and is not — the app's orders are not distinguishable from
counter orders in Clover, redemptions were never recorded server-side, and it
would credit Petals for orders that already spent them.

---

## 6. Running cost

| | |
|---|---|
| Railway Postgres | **$5/month** on the hobby plan. Free on Neon or Supabase at this volume, at the cost of a second vendor |
| Storage | kilobytes. 600 orders per sample period; a ledger row is ~100 bytes |
| Requests | one balance read per launch, one per order. No new per-message cost — this is why no SMS |
| **Total** | **$5/month, or $0 with an external free tier** |

**Engineering: about a day and a half.** Schema and migrations; the four
endpoints; moving the award path and the launch sweep to treat the server as
authority; the reserve/settle/release state machine; the claim flow and its
rate limit; the migration; UI for the unavailable state; and tests for each
transition including the ones that must not double-count.

---

## 7. What I need from you before I build

1. **Provision the database, or tell me which.** Railway Postgres at $5/month
   is one click in your dashboard and I cannot buy it on your account. Say
   "Railway" and add `DATABASE_URL`, or say "Neon" and I will use the free tier.
2. **Confirm the 24-hour reservation expiry** and the lazy release, rather than
   a cron.
3. **Confirm the migration trusts the device balance once.** This is the one
   decision that cannot be undone quietly, because it mints Petals from
   unverifiable input.
4. **Confirm a claim moves a balance rather than copying it** — the old device
   loses access.

Nothing here is built. Once those four are settled it is a single branch.


---

# Built — what changed from this scope

The scope above is what was proposed. This is what exists, and where it differs.

## One table, not two

`reservation` became **`petals_order`: one row per app order, reward or not.**

The scope missed that **earning needs server-side state too.** A reservation
table only records holds, and the earnable — how many Petals a paid order is
worth — has to survive from order creation until Clover confirms the payment.
By then the cart it was computed from is long gone. The client used to hold
that number, which is exactly the arrangement this work moves away from.

So every app order gets a row carrying `hold` (0 when no reward) and
`earnable`, and payment does both things at once: settle the hold, credit the
earnable, each under its own idempotency key.

`earnable` is computed **by the server**, from the re-priced cart less the
server's own discount — `trustedSubtotal` in `server/app.js`, built on the same
`trustedLine` the discount uses. A client that inflates its line prices earns
nothing extra.

## Earning requires having joined

A phone with no customer row gets no order row and earns nothing. The server
does not enrol someone because they gave a number for the ticket — joining is
`POST /petals/claim`, which the app calls on sign-in.

## States

`open → settled` (paid), `open → released` (voided), `open → expired` (held
past 24 hours). Expiry only touches rows that actually hold something; an
unpaid order with no reward simply never earns, so there is nothing to release.

## Time has one source

A bug the tests caught, worth recording because the shape recurs: the store
stamped `created_at` from its own `new Date()` while the expiry sweep measured
age against an injected clock. Two clocks, so the sweep never fired and could
not be tested. Now the **logic** owns time — every write passes its own `at`,
and both stores *throw* rather than defaulting when it is missing, on the same
reasoning as `hours.js` and `prep.js`.

## Refusing is in front of the order, holding is behind it

The balance check runs **before** the order reaches Clover and refuses the
whole order with 409 if the balance cannot pay — the opposite of this project's
usual "push the order first". A discount the customer has not got is money off
the till no later step can claw back, and they are standing at the counter with
the food. Refusing is recoverable: they order again without the reward.

The hold itself is taken **after** the order exists, because it is keyed on the
Clover order id. A failure there does not fail the order — the ticket is already
on the register — it is logged loudly, and the cost is one reward unpaid-for,
bounded by the reward's own cap.

## What is tested, and what is not

**52 tests.** The arithmetic and the state machine are covered against the
in-memory store: credited once per order however many times payment is
reported, a void returning the hold, a settled reward that cannot be released,
two holds that cannot overdraw one balance, the migration applying once however
often it is retried, earning on the net rather than the gross, and the awkward
expired-then-paid case where the hold is already gone and settle must not
re-deduct.

**The Postgres SQL is written and unexercised.** There is no `DATABASE_URL` to
run it against, so a green suite proves the logic and says nothing about the
SQL. Run it once against a real database before trusting it.

## Still to do

- **the client half**: fetching the balance on launch and after each order,
  showing it as unavailable when the server cannot be reached, and removing the
  device balance as a source of truth
- **provision the database** and set `DATABASE_URL`. Until then Petals are OFF:
  the endpoints answer `503 PETALS_UNAVAILABLE`, ordering is untouched, and the
  boot banner says so. There is deliberately no in-memory fallback — that would
  lose balances on the next deploy, silently
- run the suite once against a real Postgres


---

# Run against a real Postgres — what the SQL actually did

Run against Postgres 17 locally (a throwaway cluster, never production). Seven
of the eight checks behaved exactly as the in-memory store did. One did not,
and it was the one the in-memory store is structurally incapable of catching.

| | Result |
|---|---|
| schema applies, claim round-trips | as expected |
| `ON CONFLICT (idem_key) DO NOTHING` makes a repeat credit a no-op | as expected — `RETURNING id` comes back empty, which the store reads correctly |
| `SUM(delta)` | returns a **number**, not the string `pg` gives for some bigint aggregates |
| NULL `idem_key` rows | do **not** collide — Postgres treats NULLs as distinct, so unkeyed rows are not deduped. Correct, and now asserted so nobody makes the column NOT NULL |
| rollback after a mid-transaction write | discards it completely |
| `created_at < $1` against a JS Date | compares correctly as timestamptz |
| settle credits the earnable exactly once | as expected |
| **two orders racing one balance** | **OVERDREW to −40** |

## The overdraw

`openOrder` checked the balance and then inserted, inside one transaction at
READ COMMITTED. `SELECT SUM(delta)` takes no locks, so there is a window
between the check and the insert. Two transactions interleaved so both read
before either wrote, against a 200-Petal balance with a 120 hold each:

```
A reads balance: 200
B reads balance: 200     <- both see the full balance
each needs 120; each thinks it can afford it: true
A committed: true   B committed: true
final balance: -40
```

Two customers tapping "place order" in the same second is a lunch rush, not an
edge case.

**Fix:** `FOR UPDATE` on the customer lookup in `store.pg.js`. Every
balance-changing path starts by finding the customer, so locking that row
serialises those paths per customer — and only per customer, so two different
people never wait on each other. Re-run: B blocks, then reads 80 once A
commits, and correctly refuses. Final balance 80.

## Why the in-memory store could not find it

Its `tx` serialises: every transaction queues behind the last. I had called
that "stricter than Postgres, the right direction for a test double". That was
wrong in the way that mattered — **a serialised double cannot fail a
concurrency test**, so it passed identically before and after the fix.

## A test that nearly proved nothing

My first version of the race test called `openOrder` twice inside
`Promise.allSettled`. It passed. It also passed with `FOR UPDATE` removed,
because two fast transactions do not interleave — the first finishes before the
second starts.

`src/test/petalsPg.test.js` now drives the interleaving through raw clients,
replaying the statement sequence `openOrder` performs, and **runs it both
ways**: it asserts the unlocked form reaches −40 and the locked form reaches 80.
It cannot pass vacuously. A second, source-level test pins the store to the
locking form, so the behaviour test and the code cannot drift apart.

The suite skips all of it unless `PETALS_TEST_DATABASE_URL` is set:

```bash
PETALS_TEST_DATABASE_URL=postgres://user@127.0.0.1:5432/db npm test
```
