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
});

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
  async function claim({ name, phone, deviceBalance = 0 }) {
    const p = normalisePhone(phone);
    if (!p) throw new PetalsError("BAD_PHONE", "That doesn't look like a 10-digit US number.");
    const cleanName = String(name ?? "").trim();
    if (!cleanName) throw new PetalsError("NAME_REQUIRED", "We need the name on the account.");

    return store.tx(async (tx) => {
      let customer = await tx.findCustomerByPhone(p);
      if (!customer) {
        customer = await tx.createCustomer({ phone: p, name: cleanName, at: stamp() });
      } else if (normaliseName(customer.name) !== normaliseName(cleanName)) {
        throw new PetalsError("NAME_MISMATCH", "That name doesn't match the one on this number.");
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
      return { petals: await tx.balanceOf(customer.id), known: true };
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
      return { credited: wrote ? amount : 0, petals: await tx.balanceOf(customer.id) };
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
      await tx.setOrderState(r.id, "settled", stamp());
      return { settled: true, state: "settled", credited, petals: await tx.balanceOf(r.customerId) };
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

  /** For a caller that wants the sweep without reading a balance. */
  async function expire(customerId = null) {
    return store.tx(async (tx) => ({ released: await expireHeld(tx, customerId) }));
  }

  return { balance, claim, credit, openOrder, settle, release, expire };
}
