/**
 * The Petals store, on Postgres.
 *
 * The first thing in this project that needs real storage. Everything else the
 * proxy holds — the printer cache, the rate limiter, the order replay map — is
 * documented as per-process and disposable. A balance is not disposable.
 *
 * `pg` is imported dynamically so the rest of the server, and the whole test
 * suite, runs without the dependency installed. Petals are off unless a
 * DATABASE_URL is configured; there is no in-memory fallback in production,
 * because a proxy that quietly kept balances in memory would lose them on the
 * next deploy and nobody would find out until a customer complained.
 *
 * Every method here is the Postgres half of the contract in store.memory.js,
 * and contract.test.js runs one suite against both so they cannot drift. When
 * DATABASE_URL is absent those cases skip — so treat a green suite as proof of
 * the LOGIC, and run it once against a real database before trusting the SQL.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/* Timestamps come from the caller, never from `now()` in SQL. The logic owns
   the clock — see the note in ledger.js — and a missing one throws rather than
   silently measuring a reservation's age against a different clock. */
const need = (at, where) => {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) {
    throw new Error(`${where} needs an \`at\` Date — time has one source, see ledger.js`);
  }
  return at;
};

export async function createPgStore({ connectionString, ssl } = {}) {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) throw new Error("createPgStore needs a DATABASE_URL");

  let pg;
  try {
    pg = await import("pg");
  } catch {
    throw new Error(
      "Petals balances need the `pg` package. Run `npm install pg`, or leave " +
      "DATABASE_URL unset to run without server-side balances."
    );
  }

  const { Pool } = pg.default ?? pg;
  const pool = new Pool({
    connectionString: url,
    /* Railway's managed Postgres presents a certificate the default settings
       reject. Overridable so a local or self-hosted database can be strict. */
    ssl: ssl ?? (/railway|render|supabase|neon/i.test(url) ? { rejectUnauthorized: false } : undefined),
    max: 5,
  });

  await pool.query(readFileSync(resolve(HERE, "schema.sql"), "utf8"));

  const rowToCustomer = (r) => r && ({
    id: Number(r.id), phone: r.phone, name: r.name, createdAt: r.created_at,
  });
  const rowToOrder = (r) => r && ({
    id: Number(r.id), customerId: Number(r.customer_id), orderId: r.order_id,
    rewardId: r.reward_id, hold: Number(r.hold), amountCents: Number(r.amount_cents),
    earnable: Number(r.earnable), state: r.state, createdAt: r.created_at,
  });

  const bind = (q) => ({
    async findCustomerByPhone(phone) {
      const { rows } = await q("SELECT * FROM petals_customer WHERE phone = $1", [phone]);
      return rowToCustomer(rows[0]) ?? null;
    },

    async createCustomer({ phone, name, at }) {
      /* ON CONFLICT rather than check-then-insert: two requests for a new
         customer can race, and the unique index is the only thing that settles
         it without a lock. */
      const { rows } = await q(
        `INSERT INTO petals_customer (phone, name, created_at) VALUES ($1, $2, $3)
         ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
         RETURNING *`,
        [phone, name, need(at, "createCustomer")]
      );
      return rowToCustomer(rows[0]);
    },

    async appendLedger({ customerId, delta, reason, orderId = null, rewardId = null, idemKey = null, at }) {
      // DO NOTHING on the unique idem_key is what makes a repeat a no-op.
      const { rows } = await q(
        `INSERT INTO petals_ledger (customer_id, delta, reason, order_id, reward_id, idem_key, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (idem_key) DO NOTHING
         RETURNING id`,
        [customerId, delta, reason, orderId, rewardId, idemKey, need(at, "appendLedger")]
      );
      return rows.length > 0;
    },

    async balanceOf(customerId) {
      const { rows } = await q(
        "SELECT COALESCE(SUM(delta), 0) AS petals FROM petals_ledger WHERE customer_id = $1",
        [customerId]
      );
      return Number(rows[0]?.petals ?? 0);
    },

    async createOrderRow({ customerId, orderId, rewardId, hold, amountCents, earnable, at }) {
      const { rows } = await q(
        `INSERT INTO petals_order
           (customer_id, order_id, reward_id, hold, amount_cents, earnable, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (order_id) DO UPDATE SET order_id = EXCLUDED.order_id
         RETURNING *`,
        [customerId, orderId, rewardId ?? null, hold ?? 0, amountCents ?? 0,
         earnable ?? 0, need(at, "createOrderRow")]
      );
      return rowToOrder(rows[0]);
    },

    async findOrderRow(orderId) {
      const { rows } = await q("SELECT * FROM petals_order WHERE order_id = $1", [orderId]);
      return rowToOrder(rows[0]) ?? null;
    },

    async setOrderState(id, state, at) {
      const { rowCount } = await q(
        `UPDATE petals_order
            SET state = $2,
                settled_at = CASE WHEN $2 = 'open' THEN NULL ELSE $3::timestamptz END
          WHERE id = $1`,
        [id, state, need(at, "setOrderState")]
      );
      return rowCount > 0;
    },

    /* Only rows that hold something need releasing; an unpaid order with no
       reward simply never earns. */
    async openHoldsBefore(customerId, cutoff) {
      const { rows } = customerId === null
        ? await q("SELECT * FROM petals_order WHERE state = 'open' AND hold > 0 AND created_at < $1", [cutoff])
        : await q(
            `SELECT * FROM petals_order
              WHERE state = 'open' AND hold > 0 AND created_at < $1 AND customer_id = $2`,
            [cutoff, customerId]
          );
      return rows.map(rowToOrder);
    },
  });

  return {
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn(bind((sql, params) => client.query(sql, params)));
        await client.query("COMMIT");
        return out;
      } catch (e) {
        /* A rollback that itself fails must not mask the real error — that is
           how a constraint violation gets reported as a connection problem. */
        try { await client.query("ROLLBACK"); } catch { /* keep the original */ }
        throw e;
      } finally {
        client.release();
      }
    },
    async close() { await pool.end(); },
  };
}
