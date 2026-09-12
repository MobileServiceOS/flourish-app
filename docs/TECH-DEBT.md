# Tech debt — things deliberately left, with the reason and the fix

Not a wishlist. Each entry is something that was diagnosed, understood, and
then *not* fixed on purpose, with enough detail that whoever picks it up does
not have to rediscover it.

---

## 1. The test suite runs one file at a time to hide a shared-env flake

**Status: worked around in `vite.config.js` (`fileParallelism: false`). The real
fix is not done.**

### What happens

`process.env` is one object shared by every test file vitest runs concurrently
in the same process. Three suites mutate it:

| file | what it sets |
|---|---|
| `src/test/guard.test.js` | the guard's env keys, via a `setEnv` helper |
| `src/test/printer.test.js` | `APP_KEY = "set-by-someone-else"`, then deletes it |
| `src/test/release.test.js` | `ALLOWED_ORIGINS` |

All three save the previous value and restore it. That protects against
*sequential* interference and does nothing about concurrent: while
`printer.test.js` holds `APP_KEY` for the two assertions that prove the key is
read at call time, any request executing in `printUrl.test.js` or
`guard.test.js` sees a key it never set and is rejected with a 401.

The window is a few milliseconds inside a ~35-second suite, so it appeared as a
single unexplained failure in roughly one run in ten, then stayed hidden for ten
more. It cost an afternoon to even believe in.

**This project has already been bitten by the same hazard once.** It is why
`appKey()` in `server/guard.js` reads `process.env.APP_KEY` at call time instead
of capturing it at import — there is a test in `printer.test.js` whose comment
records the original incident. That fix moved *where* the value is read. It did
not change *who can change it*, which is the half that remains.

### Why it was not fixed properly

It was found on the eve of an App Store submission, and the fix touches
`server/guard.js` — the file holding the rate limit, the origin allowlist, the
charge ceiling and the app key. Changing the security boundary to make a test
suite tidier, hours before archiving a build, is the wrong trade.

**The workaround is not cheap.** Measured: the suite goes from **~35s to
~125s**. An earlier estimate of "about 30 seconds" was wrong by a factor of
three. Nearly four minutes of every ten spent waiting on tests is the kind of
friction that makes people stop running them, so this should be fixed early in
the next cycle rather than lived with.

### The actual fix

Thread a config object through the guard instead of reading the environment at
module scope. The seam is already half-built: `requireAppKeyWith(getKey)` exists
precisely so a caller can inject the key.

What makes it more than a one-liner is that two other values are computed **at
import time**:

```js
export const ALLOWED_ORIGINS = clean(process.env.ALLOWED_ORIGINS).split(",")...
export const MAX_CHARGE_DOLLARS = Number(clean(process.env.MAX_CHARGE_DOLLARS)) || 500;
```

So the shape is `createGuards({ appKey, allowedOrigins, maxChargeDollars })`,
built once in `server/index.js` from the environment and passed to `createApp`,
with the module-level exports kept as thin defaults for anything that still
imports them. Then:

- no test needs to touch `process.env` — they construct guards with the values
  they want
- `fileParallelism: false` comes back out of `vite.config.js`
- the suite should be green over **20 consecutive runs** before this is called
  done, because one clean run proves nothing about a one-in-ten flake

Worth doing early in a cycle, not late.

---

## 2. The idempotency and rate-limit stores are per-process

**Status: correct for one instance, documented at both call sites.**

The rate limiter (`server/guard.js`), the printer cache and the order
idempotency map (`server/app.js`) are all in-memory. Behind more than one
Railway instance each becomes per-instance: the rate limit multiplies by the
instance count, and two replayed orders landing on different instances both
create an order.

Not a problem today — the proxy runs as a single instance and the traffic is one
Bronx restaurant. It becomes one the moment anyone scales it horizontally, which
is exactly the kind of change nobody remembers to check for. The fix is shared
storage for all three; the Postgres added for Petals balances is the obvious
home, and the idempotency table wants the same `unique` treatment the ledger
gets.


---

## 3. `/health` gained a build marker because the deployed version was unknowable

**Status: fixed. Recorded because the gap is the kind that recurs.**

The app went live while the proxy and the app ship separately — the app through
App Store review, the proxy on every push to main. So they can be different
versions, and there was no way to tell which.

`/health` returned the same key set before and after the
server-authoritative-discount change, and **no request can safely probe for the
difference**: every path that would reveal the new reward handling reaches it
only after the point where an older build would already have created a real
order on the live register.

One direction is genuinely harmful. A published app that sends `rewardId`
against a proxy predating that change gets **no discount at all** — the old
proxy reads `reward`, which the new client no longer sends — and the customer is
charged full price at the counter having been told a reward applied, with the
voucher consumed.

`/health` now carries `build: { version, commit }`, with `commit` from
`RAILWAY_GIT_COMMIT_SHA`. Before shipping a build that changes the client/proxy
contract, read it and confirm the proxy is the newer of the two.


---

## 4. A second, unexplained intermittent test timeout

**Status: observed once, not reproduced. Recorded rather than dismissed.**

`petalsEndpoints.test.js > reading a balance > refuses a mismatched name`
timed out at the 20s `testTimeout` during one full-suite run. It passed in
isolation immediately afterwards, and in two further complete runs. So: one
occurrence, four clean runs, no explanation.

**What rules out the known cause.** Entry #1 in this file is a shared
`process.env` race, worked around with `fileParallelism: false`. That workaround
was already in place when this happened, and serialised files cannot race on the
environment — so this is a different cause, and #1's fix does not cover it.

**What it is not:** a rate limit or a guard rejection would return 429 or 401,
not hang. A timeout means a request that never got a response.

**Where to look first.** Module-level state in `server/app.js` that survives
between test files now that they all run in one process, in order:
`orderReplies` and `ordersInFlight` (the order idempotency maps) and the guard's
rate-limit window. `ordersInFlight` is the most suspicious — a key left in that
Set makes a later request return 409, not hang, but it is the only piece of
cross-file state whose lifetime is tied to a request completing. The Petals
memory store's `tx` queue is the other candidate: it serialises through a
promise chain, and a rejection handled wrongly there would stall every
subsequent transaction in the process, which matches the symptom exactly.

Reproduce before fixing. A one-in-many flake needs a loop of full runs, not one.
