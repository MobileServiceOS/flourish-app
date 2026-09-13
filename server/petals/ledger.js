/**
 * Petals balances, server-side.
 *
 * The balance used to live in one JSON blob on the customer's phone. That was
 * defensible while the app was a side channel; it stops being defensible the
 * moment every customer is told to download it, because a reinstall or a new
 * phone wipes a balance with no record anywhere and staff take the complaint
 * with nothing to look it up in.
 *
 * THE LEDGER IS THE BALANCE. There is no mutable `petals` column, deliberately.
 * Every question anyone actually asks is historical — why is my balance 40 and
 * not 90, was this reward already used, did that voided order give my Petals
 * back — and a single integer cannot answer one of them. A balance people argue
 * about at a counter needs a trail.
 *
 * SPENDING MIRRORS EARNING. Earning was fixed long ago to wait for Clover to
 * confirm the payment; spending never got the same treatment, so a voided order
 * cost the customer both the food and the Petals with nothing to restore them.
 * Now: reserve when the order is created, settle when it is paid, release when
 * it is voided — and release anything still held after a day, for the customer
 * who simply never came back.
 *
 * Every write carries a deterministic `idemKey` with a unique constraint behind
 * it, so double-crediting is structurally impossible rather than carefully
 * avoided. That is the same trick as the order idempotency key, applied to
 * something that behaves like money.
 */

/** A held reservation older than this is released. A day, matching the sweep. */
export const RESERVATION_TTL_MS = 24 * 60 * 60 * 1000;

export const REASONS = Object.freeze({
  EARNED: "earned",
  RESERVED: "reserved",
  RELEASED: "released",
  ADJUSTED: "adjusted",
  RECEIPT: "receipt",
  SIGNUP: "signup",
  BIRTHDAY: "birthday",
  REFERRAL: "referral",
  PERKS_MATCH: "perks match",
});

/* ============================================================================
   EARNING WITHOUT AN APP ORDER

   Five ways in, and one rule holding all of them: a credit is a ledger row with
   a deterministic idem_key, and the UNIQUE index is what makes it once-only.
   Not a check-then-write — two requests in the same second both pass a check.

   THE NUMBERS, AND WHY THEY ARE WHAT THEY ARE. A Petal is worth 5c at every
   rung of the ladder except the free plate, which is 5.71c (350 -> $20). So
   "worst case value" below always means the plate rate, because a customer
   maximising value takes plates.
   ============================================================================ */

/** First account on a phone number, ever. Worth $2.50 at the plate rate. */
export const SIGNUP_BONUS = 50;

/** Each side of a referral, when the referred friend's first order is PAID. */
export const REFERRAL_BONUS = 100;

/** The Perks match ceiling. Staff type a balance; this is what actually lands. */
export const PERKS_MATCH_CAP = 200;

/**
 * The birthday reward, granted as Petals rather than as a special voucher.
 *
 * The offer is "a free plate up to $20". 350 Petals is exactly the cost of the
 * free-plate reward, so the customer can take that plate — and the existing cap
 * machinery bounds it at $20 with no new code in the order path.
 *
 * It is never MORE expensive than the offer: the plate is the only rung worth
 * 5.71c per Petal, every other rung is 5c, so 350 Petals spent any other way is
 * worth at most $17.50. Granting the Petals is therefore weakly cheaper than
 * granting the plate, and strictly more useful to a customer who would rather
 * have drinks. A dedicated voucher would have meant a reward with no cost
 * threaded through resolveReward, openOrder and the client — new machinery on
 * the one path that moves money, to be worth less.
 */
export const BIRTHDAY_PETALS = 350;

/** A receipt is claimable for this long after the order. */
export const RECEIPT_CLAIM_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How many counter receipts one phone may claim, and over what window.
 *
 * The attack this bounds is someone lifting receipts off the counter, or out of
 * the bin, and claiming other people's orders. Nothing in a printed receipt
 * proves who paid, so the claim cannot be authenticated — it can only be
 * rate-limited and made once-only per order.
 *
 * Three a day is set from real data: the shop turns ~741 orders a week and the
 * average order nets $21.58, so an unbounded claimer could take roughly 16,000
 * Petals a week — $800 at the plate rate. Three a day caps one phone at about
 * 450 Petals a week, $23. A genuine customer eating there daily is unaffected.
 */
export const RECEIPT_CLAIMS_PER_DAY = 3;
export const RECEIPT_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;

/* Crockford base32 minus the vowels that make words: a code goes on a flyer and
   gets read aloud, so it must not be mistakable and must not spell anything. */
const CODE_ALPHABET = "0123456789BCDFGHJKMNPQRSTVWXYZ";

export class PetalsError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "PetalsError";
    this.code = code;
    Object.assign(this, extra);
  }
}

/** Digits only, US 10-digit, stored E.164 so one customer is one row. */
export function normalisePhone(phone) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) return null;
  return `+1${ten}`;
}

/* Names are compared loosely on purpose: "Nevaeh  Reid", "nevaeh reid" and
   "Nevaeh Reid" are the same person typing on a phone keyboard. Anything
   stricter turns a legitimate customer away from their own balance, and the
   name is a speed bump against strangers rather than a password — see
   docs/PETALS-SERVER-SCOPE.md for exactly what this does and does not
   protect. */
export const normaliseName = (name) =>
  String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Tidy a hand-typed order id or suffix from a receipt.
 *
 * Clover ids are 13 characters of Crockford base32 — `0123456789ABCDEFGHJKMNPQRSTVWXYZ`,
 * which deliberately omits I, L, O and U. So a customer who types O for 0, or I
 * or L for 1, cannot be typing a real character and can be mapped back with no
 * ambiguity whatsoever. That is Crockford's own decoding rule and it removes
 * the single most common transcription error for free.
 */
export function normaliseOrderRef(ref) {
  /* ONLY the four characters Clover's alphabet omits may be remapped. Q is a
     REAL character in it (…MNPQRST…) and mapping Q to 0, as a first draft of
     this did, silently corrupts every id containing one — turning a valid
     receipt into "not found", or worse into a different order. Verified against
     5,000 live ids: the alphabet is 0123456789ABCDEFGHJKMNPQRSTVWXYZ. */
  return String(ref ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0").replace(/[IL]/g, "1").replace(/U/g, "V");
}

/**
 * Month and day, or null. The YEAR is discarded here and never stored.
 *
 * Accepts a `YYYY-MM-DD` from a date input and a bare `MM-DD`, and validates
 * the day against the month so 31 February cannot be stored. February allows 29
 * because the year is unknown and refusing a leap-day birthday would be absurd.
 */
export function parseBirthday(value) {
  const m = /^(?:\d{4}-)?(\d{1,2})-(\d{1,2})$/.exec(String(value ?? "").trim());
  if (!m) return null;
  const month = Number(m[1]), day = Number(m[2]);
  if (!(month >= 1 && month <= 12) || !(day >= 1)) return null;
  const maxDay = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day > maxDay) return null;
  return { month, day };
}

/** New York's month, for the birthday window — see availability.js for why. */
export const monthInNewYork = (ms) =>
  Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "numeric" })
    .format(new Date(ms)));
export const yearInNewYork = (ms) =>
  Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric" })
    .format(new Date(ms)));

export function createPetals({ store, now = () => Date.now(), ttlMs = RESERVATION_TTL_MS }) {
  if (!store) throw new Error("createPetals needs a store");

  /* Time has ONE source: the clock injected here. The store used to stamp
     `created_at` itself, which meant a reservation's age was measured against a
     different clock from the one deciding whether it had expired — so the sweep
     was untestable and, in principle, wrong. Every write passes its own `at`
     and the stores require it rather than defaulting, on the same reasoning as
     hours.js and prep.js: a default would quietly reintroduce the bug. */
  const stamp = () => new Date(now());

  /** Release anything held past its life, so a balance is never stuck. */
  async function expireHeld(tx, customerId) {
    const cutoff = new Date(now() - ttlMs);
    const stale = await tx.openHoldsBefore(customerId, cutoff);
    for (const r of stale) {
      await tx.appendLedger({
        customerId: r.customerId,
        delta: r.hold,
        reason: REASONS.RELEASED,
        orderId: r.orderId,
        rewardId: r.rewardId,
        idemKey: `release:${r.orderId}`,
        at: stamp(),
      });
      await tx.setOrderState(r.id, "expired", stamp());
    }
    return stale.length;
  }

  /**
   * The balance, and the reason it can be trusted.
   *
   * Expiry runs first, lazily, so a stale hold cannot make a balance look
   * smaller than it is. Doing it here rather than on a schedule means no cron
   * to monitor and no new process: the only person who cares is the customer
   * looking at the number, and they are the one triggering it.
   */
  async function balance({ name, phone }) {
    const p = normalisePhone(phone);
    if (!p) throw new PetalsError("BAD_PHONE", "That doesn't look like a 10-digit US number.");
    return store.tx(async (tx) => {
      const customer = await tx.findCustomerByPhone(p);
      if (!customer) return { petals: 0, known: false };
      /* The name has to match to READ a balance too, not just to claim one.
         A balance is not secret, but a phone number alone should not display
         someone else's total to a stranger who mistyped. */
      if (normaliseName(customer.name) !== normaliseName(name)) {
        throw new PetalsError("NAME_MISMATCH", "That name doesn't match the one on this number.");
      }
      await expireHeld(tx, customer.id);
      return { petals: await tx.balanceOf(customer.id), known: true };
    });
  }

  /**
   * Bind this phone to a balance, creating the customer if new, and carry a
   * device balance across exactly once.
   *
   * `deviceBalance` exists only for the migration off device-only storage. The
   * unique idemKey means it can be attempted any number of times and applied
   * once, whatever the app retries and however many devices try it. What it
   * accepts, knowingly, is whatever the customer had in their own storage —
   * including anything they edited. The alternative is telling real customers
   * their balance is gone because the app could not prove it, which costs more
   * than the handful of people who will bother to forge $22. Every migration
   * row is an `adjusted` entry in the ledger, so it is auditable afterwards.
   */
  async function claim({ name, phone, deviceBalance = 0, birthday = null, referralCode = null }) {
    const p = normalisePhone(phone);
    if (!p) throw new PetalsError("BAD_PHONE", "That doesn't look like a 10-digit US number.");
    const cleanName = String(name ?? "").trim();
    if (!cleanName) throw new PetalsError("NAME_REQUIRED", "We need the name on the account.");
    const born = birthday === null || birthday === "" ? null : parseBirthday(birthday);
    if (birthday && !born) {
      throw new PetalsError("BAD_BIRTHDAY", "That date doesn't look right.");
    }

    return store.tx(async (tx) => {
      let customer = await tx.findCustomerByPhone(p);
      const isNewCustomer = !customer;
      if (!customer) {
        customer = await tx.createCustomer({ phone: p, name: cleanName, at: stamp() });
      } else if (normaliseName(customer.name) !== normaliseName(cleanName)) {
        throw new PetalsError("NAME_MISMATCH", "That name doesn't match the one on this number.");
      }

      /* ---- signup bonus ----
         Attempted on every claim, not only when the row is created, and made
         once-only by the key rather than by `isNewCustomer`. Deleting the app
         and signing up again recreates the local account but not the ledger
         row, so the key is the thing that actually enforces "once per phone
         number, ever" — the flag would hand out a second bonus to anyone who
         reinstalled. */
      const gotSignup = await tx.appendLedger({
        customerId: customer.id, delta: SIGNUP_BONUS, reason: REASONS.SIGNUP,
        idemKey: `signup:${p}`, at: stamp(),
      });

      /* ---- birthday ----
         Stored month and day only. Editable, because people mistype — the
         once-per-year key is what stops an edit being worth anything, not
         immutability. */
      const patch = {};
      if (born && (customer.birthMonth !== born.month || customer.birthDay !== born.day)) {
        patch.birthMonth = born.month; patch.birthDay = born.day;
      }
      if (!customer.referralCode) patch.referralCode = await mintCode(tx);

      /* ---- who referred them ----
         ONLY on a genuinely new customer, and never overwritten. An existing
         customer entering a code later would let two people who already eat
         here pay each other, which is not what the scheme is for. */
      let referralAccepted = false;
      const code = String(referralCode ?? "").trim().toUpperCase();
      if (code && isNewCustomer && !customer.referredBy) {
        const referrer = await tx.findCustomerByReferralCode(code);
        if (referrer && referrer.id !== customer.id && referrer.phone !== p) {
          patch.referredBy = referrer.id;
          referralAccepted = true;
        }
      }
      if (Object.keys(patch).length) {
        customer = (await tx.updateCustomer(customer.id, patch)) ?? customer;
      }

      const migrate = Math.floor(Number(deviceBalance) || 0);
      if (migrate > 0) {
        await tx.appendLedger({
          customerId: customer.id,
          delta: migrate,
          reason: REASONS.ADJUSTED,
          idemKey: `migrate:${p}`,
          at: stamp(),
        });
      }
      await expireHeld(tx, customer.id);
      return {
        petals: await tx.balanceOf(customer.id),
        known: true,
        signupBonus: gotSignup ? SIGNUP_BONUS : 0,
        referralAccepted,
        referralCode: customer.referralCode ?? null,
        birthday: customer.birthMonth
          ? { month: customer.birthMonth, day: customer.birthDay } : null,
      };
    });
  }

  /**
   * Credit an order that Clover has confirmed paid.
   *
   * Keyed on the order, so the tracking screen's poll and the launch sweep can
   * both report the same payment and it lands once.
   */
  async function credit({ phone, name, orderId, petals }) {
    const p = normalisePhone(phone);
    const amount = Math.floor(Number(petals) || 0);
    if (!p || !orderId || amount <= 0) return { credited: 0 };
    return store.tx(async (tx) => {
      let customer = await tx.findCustomerByPhone(p);
      if (!customer) {
        customer = await tx.createCustomer({
          phone: p, name: String(name ?? "").trim() || "Guest", at: stamp(),
        });
      }
      const wrote = await tx.appendLedger({
        customerId: customer.id,
        delta: amount,
        reason: REASONS.EARNED,
        orderId,
        idemKey: `earn:${orderId}`,
        at: stamp(),
      });
      // Their first paid order is the moment a referral becomes payable.
      const referral = wrote ? await maybePayReferral(tx, customer) : 0;
      return { credited: wrote ? amount : 0, referral, petals: await tx.balanceOf(customer.id) };
    });
  }

  /**
   * Record an app order: the reward hold, and what it will earn when paid.
   *
   * ONE ROW PER ORDER, whether or not a reward is on it. The earnable has to
   * survive until Clover confirms the payment, and by then the cart it was
   * computed from is long gone — the client used to hold that number, which is
   * exactly the arrangement this moved away from.
   *
   * Nothing is deducted when the customer taps redeem; that is a choice, not a
   * spend. The hold happens here, when the order becomes real, and it lowers
   * the balance so it cannot be spent twice while held.
   *
   * EARNING REQUIRES AN EXISTING BALANCE. A phone with no customer row has not
   * joined, so there is nothing to credit and no row is created — the server
   * does not enrol someone silently because they gave a number at the counter.
   */
  async function openOrder({ phone, name, orderId, rewardId = null, cost = 0, amountCents = 0, earnable = 0 }) {
    const p = normalisePhone(phone);
    if (!p) throw new PetalsError("BAD_PHONE", "That doesn't look like a 10-digit US number.");
    if (!orderId) throw new PetalsError("ORDER_REQUIRED", "A Petals order row needs an order id.");
    const hold = Math.max(0, Math.floor(Number(cost) || 0));
    const earn = Math.max(0, Math.floor(Number(earnable) || 0));

    return store.tx(async (tx) => {
      const customer = await tx.findCustomerByPhone(p);
      if (!customer) return { opened: false, reason: "NO_BALANCE" };
      if (normaliseName(customer.name) !== normaliseName(name)) {
        throw new PetalsError("NAME_MISMATCH", "That name doesn't match the one on this number.");
      }

      /* An existing row for this order is the retry case, not a second
         redemption. Return it rather than holding twice. */
      const existing = await tx.findOrderRow(orderId);
      if (existing) return { opened: false, reason: "ALREADY_OPEN", row: existing };

      await expireHeld(tx, customer.id);

      if (hold > 0) {
        const available = await tx.balanceOf(customer.id);
        if (available < hold) {
          throw new PetalsError("INSUFFICIENT_PETALS", "There aren't enough Petals on that balance.", {
            available, needed: hold,
          });
        }
        await tx.appendLedger({
          customerId: customer.id,
          delta: -hold,
          reason: REASONS.RESERVED,
          orderId, rewardId,
          idemKey: `reserve:${orderId}`,
          at: stamp(),
        });
      }

      const row = await tx.createOrderRow({
        customerId: customer.id, orderId, rewardId, hold, amountCents, earnable: earn, at: stamp(),
      });
      return { opened: true, row, petals: await tx.balanceOf(customer.id) };
    });
  }

  /**
   * The order was paid: the hold becomes a spend.
   *
   * The ledger row already stands from `reserve`, so this only closes the
   * reservation. Writing another negative row here is the mistake that would
   * charge the customer twice.
   */
  async function settle(orderId) {
    if (!orderId) return { settled: false };
    return store.tx(async (tx) => {
      const r = await tx.findOrderRow(orderId);
      if (!r || r.state !== "open") return { settled: false, state: r?.state ?? null };

      /* The hold's negative row already exists from openOrder, so nothing is
         deducted here — writing another would charge the customer twice for one
         reward. What DOES happen here is the earning, because this is the first
         moment anyone knows the money was actually taken. */
      let credited = 0;
      if (r.earnable > 0) {
        const wrote = await tx.appendLedger({
          customerId: r.customerId,
          delta: r.earnable,
          reason: REASONS.EARNED,
          orderId: r.orderId,
          idemKey: `earn:${r.orderId}`,
          at: stamp(),
        });
        if (wrote) credited = r.earnable;
      }
      /* Referral pays here too, and only here — the order being PAID is the
         trigger, never the order being placed. A voided order takes the release
         path instead and pays nobody. */
      let referral = 0;
      if (credited > 0) {
        const c = await tx.findCustomerById(r.customerId);
        if (c) referral = await maybePayReferral(tx, c);
      }
      await tx.setOrderState(r.id, "settled", stamp());
      return { settled: true, state: "settled", credited, referral,
               petals: await tx.balanceOf(r.customerId) };
    });
  }

  /** The order was voided: give the Petals back. */
  async function release(orderId) {
    if (!orderId) return { released: false };
    return store.tx(async (tx) => {
      const r = await tx.findOrderRow(orderId);
      if (!r || r.state !== "open") return { released: false, state: r?.state ?? null };
      /* A void earns nothing — the money was never taken — and gives back
         whatever was held. The customer lost the food; they must not also lose
         the reward. */
      if (r.hold > 0) {
        await tx.appendLedger({
          customerId: r.customerId,
          delta: r.hold,
          reason: REASONS.RELEASED,
          orderId: r.orderId,
          rewardId: r.rewardId,
          idemKey: `release:${r.orderId}`,
          at: stamp(),
        });
      }
      await tx.setOrderState(r.id, "released", stamp());
      return { released: true, petals: await tx.balanceOf(r.customerId) };
    });
  }

  /**
   * Grant or correct a balance, by hand, with a reason on the record.
   *
   * The shop will need this: a customer whose order was voided after they had
   * eaten, a goodwill credit, a balance typed wrong at a counter. Doing it with
   * a SQL poke would leave a number nobody could explain later, which is the
   * whole reason the ledger exists rather than a mutable column.
   *
   * `reason` is required and stored. `idemKey` is required too — an adjustment
   * is the one write with no natural key of its own, and without one a retried
   * request grants twice. The caller names it: `grant:test-1000:<phone>`.
   *
   * Negative deltas are allowed, and may take a balance below zero. That is
   * deliberate: a correction that silently clamped would hide the error it was
   * made to fix.
   */
  async function adjust({ name, phone, delta, reason, idemKey }) {
    const p = normalisePhone(phone);
    if (!p) throw new PetalsError("BAD_PHONE", "That doesn't look like a 10-digit US number.");
    const amount = Math.trunc(Number(delta));
    if (!Number.isFinite(amount) || amount === 0) {
      throw new PetalsError("BAD_DELTA", "An adjustment needs a non-zero whole number of Petals.");
    }
    const why = String(reason ?? "").trim();
    if (!why) throw new PetalsError("REASON_REQUIRED", "An adjustment has to say why.");
    const key = String(idemKey ?? "").trim();
    if (!key) throw new PetalsError("IDEM_REQUIRED", "An adjustment needs an idempotency key.");

    return store.tx(async (tx) => {
      let customer = await tx.findCustomerByPhone(p);
      if (!customer) {
        customer = await tx.createCustomer({
          phone: p, name: String(name ?? "").trim() || "Guest", at: stamp(),
        });
      }
      const wrote = await tx.appendLedger({
        customerId: customer.id,
        delta: amount,
        reason: `${REASONS.ADJUSTED}: ${why}`.slice(0, 200),
        idemKey: `grant:${key}`,
        at: stamp(),
      });
      return {
        applied: wrote ? amount : 0,
        alreadyApplied: !wrote,
        petals: await tx.balanceOf(customer.id),
      };
    });
  }

  /* ========================================================================
     EARNING WITHOUT AN APP ORDER
     ======================================================================== */

  /** Mint a referral code that is not already taken. */
  async function mintCode(tx) {
    for (let attempt = 0; attempt < 12; attempt++) {
      let code = "";
      for (let i = 0; i < 6; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      if (!(await tx.findCustomerByReferralCode(code))) return code;
    }
    /* Thirty characters to the sixth is 729 million codes; twelve misses means
       something is wrong with the store, not bad luck. Throwing beats handing
       out a duplicate code, which would pay the wrong referrer. */
    throw new PetalsError("CODE_EXHAUSTED", "Could not allocate a referral code.");
  }

  /**
   * Pay both sides of a referral, if this customer was referred and their
   * first paid order has just landed.
   *
   * Called from every path that writes an EARNED or RECEIPT row, because
   * "their first order is paid" is true at whichever of those happens first.
   * NEVER called on order creation — the same rule as ordinary earning, and it
   * is the thing that stops the scheme being farmed with orders nobody pays
   * for. A voided order never reaches here, so a referrer earns nothing from
   * one.
   */
  async function maybePayReferral(tx, customer) {
    if (!customer?.referredBy) return 0;

    /* The referee's own row is keyed on their phone, so this whole block is a
       no-op the second time regardless of how many orders they pay for. */
    const key = `referral-referee:${customer.phone}`;
    if (await tx.findLedgerByIdemKey(key)) return 0;

    const referrer = await tx.findCustomerById(customer.referredBy);
    const wroteReferee = await tx.appendLedger({
      customerId: customer.id, delta: REFERRAL_BONUS, reason: REASONS.REFERRAL,
      idemKey: key, at: stamp(),
    });
    /* Keyed on the REFEREE's phone, not the referrer's: a referrer earns once
       per person they bring, and bringing ten people pays ten times. */
    if (referrer) {
      await tx.appendLedger({
        customerId: referrer.id, delta: REFERRAL_BONUS, reason: REASONS.REFERRAL,
        idemKey: `referral-referrer:${customer.phone}`, at: stamp(),
      });
    }
    return wroteReferee ? REFERRAL_BONUS : 0;
  }

  /**
   * Credit a counter order the customer proves with their receipt.
   *
   * The CALLER verifies the order against Clover — that it exists, is paid, is
   * within the window and is not ambiguous — because that needs Clover access
   * and this file has none. What happens here is the part that must be atomic:
   * the once-ever check and the rate limit, inside the same transaction and the
   * same row lock as the write.
   *
   * ONCE EVER, BY ANYONE. The key is the order id alone and carries no customer
   * in it, so a second person claiming the same receipt collides with the first
   * person's row and is credited nothing. That is the only control there is: a
   * printed receipt does not say who paid, so the claim cannot be
   * authenticated — only bounded.
   */
  async function claimReceipt({ name, phone, orderId, petals }) {
    const p = normalisePhone(phone);
    if (!p) throw new PetalsError("BAD_PHONE", "That doesn't look like a 10-digit US number.");
    if (!orderId) throw new PetalsError("ORDER_REQUIRED", "A claim needs the order from the receipt.");
    const amount = Math.max(0, Math.floor(Number(petals) || 0));

    return store.tx(async (tx) => {
      const customer = await tx.findCustomerByPhone(p);
      if (!customer) throw new PetalsError("NO_BALANCE", "Join first, then add your past orders.");
      if (normaliseName(customer.name) !== normaliseName(name)) {
        throw new PetalsError("NAME_MISMATCH", "That name doesn't match the one on this number.");
      }

      /* Report an already-claimed order as such rather than as a silent
         no-op: the customer is standing there with a receipt and needs to be
         told which of the two it is. */
      const key = `receipt:${orderId}`;
      const already = await tx.findLedgerByIdemKey(key);
      if (already) {
        throw new PetalsError(
          "ALREADY_CLAIMED",
          already.customerId === customer.id
            ? "You've already added that order."
            : "That order has already been added to an account.");
      }

      const since = new Date(now() - RECEIPT_RATE_WINDOW_MS);
      const recent = await tx.countLedgerSince(customer.id, REASONS.RECEIPT, since);
      if (recent >= RECEIPT_CLAIMS_PER_DAY) {
        throw new PetalsError("TOO_MANY_CLAIMS",
          `That's ${RECEIPT_CLAIMS_PER_DAY} receipts added today. Try again tomorrow.`,
          { limit: RECEIPT_CLAIMS_PER_DAY });
      }

      const wrote = amount > 0 && await tx.appendLedger({
        customerId: customer.id, delta: amount, reason: REASONS.RECEIPT,
        orderId, idemKey: key, at: stamp(),
      });
      const referral = wrote ? await maybePayReferral(tx, customer) : 0;
      return {
        credited: wrote ? amount : 0,
        referral,
        petals: await tx.balanceOf(customer.id),
      };
    });
  }

  /**
   * The birthday reward: once per calendar year, during the birth month.
   *
   * Keyed on phone AND year, which is what makes editing the birth date
   * useless: a customer who claims in January, changes their birthday to
   * February and claims again hits the same key and is credited nothing. The
   * key deliberately does not contain the date itself, because a key that did
   * would make every edit a fresh entitlement.
   */
  async function birthdayReward({ name, phone }) {
    const p = normalisePhone(phone);
    if (!p) throw new PetalsError("BAD_PHONE", "That doesn't look like a 10-digit US number.");

    return store.tx(async (tx) => {
      const customer = await tx.findCustomerByPhone(p);
      if (!customer) throw new PetalsError("NO_BALANCE", "Join first.");
      if (normaliseName(customer.name) !== normaliseName(name)) {
        throw new PetalsError("NAME_MISMATCH", "That name doesn't match the one on this number.");
      }
      if (!customer.birthMonth) {
        return { credited: 0, reason: "NO_BIRTHDAY", petals: await tx.balanceOf(customer.id) };
      }
      const month = monthInNewYork(now());
      if (customer.birthMonth !== month) {
        return { credited: 0, reason: "NOT_THIS_MONTH", month: customer.birthMonth,
                 petals: await tx.balanceOf(customer.id) };
      }
      const wrote = await tx.appendLedger({
        customerId: customer.id, delta: BIRTHDAY_PETALS, reason: REASONS.BIRTHDAY,
        idemKey: `birthday:${p}:${yearInNewYork(now())}`, at: stamp(),
      });
      return {
        credited: wrote ? BIRTHDAY_PETALS : 0,
        reason: wrote ? null : "ALREADY_THIS_YEAR",
        petals: await tx.balanceOf(customer.id),
      };
    });
  }

  /**
   * Match a Clover Perks balance, once per phone, ever. Staff-initiated.
   *
   * Perks balances are unreadable through every Clover API — each loyalty path
   * answers 405 — so a human reads the number off the register and types it.
   * That makes the cap the only real control, and it is applied HERE rather
   * than in the UI: a typo, a misread, or a request sent straight to the route
   * all land at the ceiling and no further.
   */
  async function perksMatch({ name, phone, petals, staff }) {
    const p = normalisePhone(phone);
    if (!p) throw new PetalsError("BAD_PHONE", "That doesn't look like a 10-digit US number.");
    const asked = Math.floor(Number(petals) || 0);
    if (!(asked > 0)) throw new PetalsError("BAD_AMOUNT", "Enter the Perks balance to match.");
    const amount = Math.min(asked, PERKS_MATCH_CAP);

    return store.tx(async (tx) => {
      let customer = await tx.findCustomerByPhone(p);
      if (!customer) {
        customer = await tx.createCustomer({
          phone: p, name: String(name ?? "").trim() || "Perks customer", at: stamp() });
      }
      const wrote = await tx.appendLedger({
        customerId: customer.id, delta: amount,
        reason: `${REASONS.PERKS_MATCH}${staff ? ` by ${String(staff).slice(0, 40)}` : ""}`,
        idemKey: `perks:${p}`, at: stamp(),
      });
      return {
        credited: wrote ? amount : 0,
        capped: asked > PERKS_MATCH_CAP,
        asked,
        alreadyMatched: !wrote,
        petals: await tx.balanceOf(customer.id),
      };
    });
  }

  /** For a caller that wants the sweep without reading a balance. */
  async function expire(customerId = null) {
    return store.tx(async (tx) => ({ released: await expireHeld(tx, customerId) }));
  }

  return { balance, claim, credit, openOrder, settle, release, expire, adjust,
           claimReceipt, birthdayReward, perksMatch };
}
