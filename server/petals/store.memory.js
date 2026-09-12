/**
 * The Petals store, in memory.
 *
 * Not a production fallback — deliberately. A proxy that silently kept balances
 * in memory when the database was unreachable would lose them on the next
 * deploy and nobody would find out until a customer complained, which is the
 * exact failure server-side balances exist to end. `server/index.js` refuses to
 * enable Petals without a DATABASE_URL.
 *
 * This exists so the ledger logic — the reserve/settle/release state machine
 * and the balance arithmetic, which is the part that behaves like money — is
 * tested to the last case without provisioning anything. `contract.test.js`
 * runs the same suite against this and against Postgres, so the two cannot
 * drift.
 *
 * `tx` serialises rather than isolating: every transaction queues behind the
 * last one. That is stricter than Postgres, which is the right direction for a
 * test double — it cannot pass something the real store would fail on
 * concurrency grounds.
 */
/* The caller supplies every timestamp, and a missing one throws rather than
   defaulting to `new Date()`. That default was a real bug: the store stamped
   reservations from the wall clock while the expiry sweep measured them against
   an injected one, so the sweep could not be tested and, in principle, could
   measure against the wrong clock. Same reasoning as hours.js and prep.js. */
const need = (at, where) => {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) {
    throw new Error(`${where} needs an \`at\` Date — time has one source, see ledger.js`);
  }
  return at;
};

export function createMemoryStore() {
  let nextCustomerId = 1;
  let nextLedgerId = 1;
  let nextReservationId = 1;

  const customers = [];      // { id, phone, name, createdAt }
  const ledger = [];         // { id, customerId, delta, reason, orderId, rewardId, idemKey, createdAt }
  const orders = [];         // { id, customerId, orderId, rewardId, hold, amountCents, earnable, state, createdAt }

  let queue = Promise.resolve();

  const api = {
    async findCustomerByPhone(phone) {
      return customers.find((c) => c.phone === phone) ?? null;
    },

    async createCustomer({ phone, name, at }) {
      const existing = customers.find((c) => c.phone === phone);
      if (existing) return existing;   // the unique constraint, honestly modelled
      const c = { id: nextCustomerId++, phone, name, createdAt: need(at, "createCustomer") };
      customers.push(c);
      return c;
    },

    /** Returns false when the idemKey has already been written. */
    async appendLedger({ customerId, delta, reason, orderId = null, rewardId = null, idemKey = null, at }) {
      if (idemKey && ledger.some((l) => l.idemKey === idemKey)) return false;
      ledger.push({
        id: nextLedgerId++, customerId, delta, reason, orderId, rewardId, idemKey,
        createdAt: need(at, "appendLedger"),
      });
      return true;
    },

    async balanceOf(customerId) {
      return ledger.filter((l) => l.customerId === customerId)
        .reduce((n, l) => n + l.delta, 0);
    },

    async createOrderRow({ customerId, orderId, rewardId, hold, amountCents, earnable, at }) {
      const existing = orders.find((r) => r.orderId === orderId);
      if (existing) return existing;      // the unique constraint, honestly modelled
      const r = {
        id: nextReservationId++, customerId, orderId, rewardId: rewardId ?? null,
        hold: hold ?? 0, amountCents: amountCents ?? 0, earnable: earnable ?? 0,
        state: "open", createdAt: need(at, "createOrderRow"), settledAt: null,
      };
      orders.push(r);
      return r;
    },

    async findOrderRow(orderId) {
      return orders.find((r) => r.orderId === orderId) ?? null;
    },

    async setOrderState(id, state, at) {
      const r = orders.find((x) => x.id === id);
      if (!r) return false;
      r.state = state;
      r.settledAt = state === "open" ? null : need(at, "setOrderState");
      return true;
    },

    /* Only rows that actually hold something need releasing. An unpaid order
       with no reward simply never earns — there is nothing to give back. */
    async openHoldsBefore(customerId, cutoff) {
      return orders.filter((r) =>
        r.state === "open"
        && r.hold > 0
        && r.createdAt < cutoff
        && (customerId === null || r.customerId === customerId));
    },
  };

  return {
    async tx(fn) {
      // Serialise, so an interleaved read-then-write cannot see a torn state.
      const run = queue.then(() => fn(api), () => fn(api));
      queue = run.then(() => undefined, () => undefined);
      return run;
    },
    /** Tests only: reach past the interface to age a reservation or read rows. */
    __rows: { customers, ledger, orders },
    async close() {},
  };
}
