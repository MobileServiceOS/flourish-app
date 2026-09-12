import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPetals, RESERVATION_TTL_MS } from "../../server/petals/ledger.js";

/* ============================================================================
   THE SAME LEDGER, AGAINST A REAL POSTGRES

   petalsLedger.test.js proves the LOGIC against an in-memory store. It cannot
   prove the SQL, and it cannot prove anything about concurrency, because it
   serialises every transaction — which is precisely how a real bug hid in it.

   Run against a live database, this found an overdraw. Two transactions
   interleaved so both read before either wrote, against a 200-Petal balance
   with a 120 hold each: both read 200, both decided they could afford it, both
   committed, and the balance ended at MINUS 40. READ COMMITTED does not prevent
   it — `SELECT SUM(delta)` takes no locks, so check-then-insert has a window.
   Two customers tapping "place order" in the same second is a lunch rush, not
   an edge case.

   The fix is `FOR UPDATE` on the customer lookup in store.pg.js, which
   serialises the balance-changing paths per customer and only per customer.
   The last test in this file is the one that would fail without it.

   SKIPPED unless a database is pointed at it:

     PETALS_TEST_DATABASE_URL=postgres://user@127.0.0.1:5432/db npm test

   Never point this at production. It creates a uniquely named schema and drops
   it afterwards, but the safe habit is a throwaway cluster.
   ============================================================================ */

const URL_ = process.env.PETALS_TEST_DATABASE_URL;
const run = URL_ ? describe : describe.skip;

const NAME = "Nevaeh Reid";
const PHONE = "3478599413";
const E164 = "+13478599413";

run("the Petals store on Postgres", () => {
  let store, petals, clock, schema;

  beforeAll(async () => {
    const { createPgStore } = await import("../../server/petals/store.pg.js");
    schema = `petals_test_${Date.now().toString(36)}`;
    store = await createPgStore({ connectionString: URL_, ssl: false, schema });
    clock = Date.UTC(2026, 8, 12, 12, 0);
    petals = createPetals({ store, now: () => clock });
  });

  afterAll(async () => {
    if (!store) return;
    await store.dropSchema();
    await store.close();
  });

  it("applies its own schema and round-trips a claim", async () => {
    expect(await petals.claim({ name: NAME, phone: PHONE, deviceBalance: 200 }))
      .toMatchObject({ petals: 200, known: true });
  });

  it("makes a repeated credit a no-op, under a real unique index", async () => {
    /* The in-memory store models this by searching an array. Here it is
       ON CONFLICT (idem_key) DO NOTHING against an actual constraint, and
       `RETURNING id` coming back empty is what the store reads as "already
       written" — worth proving against the real planner. */
    expect(await petals.credit({ name: NAME, phone: PHONE, orderId: "O1", petals: 20 }))
      .toMatchObject({ credited: 20 });
    expect(await petals.credit({ name: NAME, phone: PHONE, orderId: "O1", petals: 20 }))
      .toMatchObject({ credited: 0 });
  });

  it("returns a NUMBER from SUM(delta), not the string pg gives for bigint", async () => {
    await store.tx(async (tx) => {
      const c = await tx.findCustomerByPhone(E164);
      const b = await tx.balanceOf(c.id);
      expect(typeof b).toBe("number");
    });
  });

  it("does not collide unkeyed rows, because Postgres treats NULLs as distinct", async () => {
    /* Deliberate: rows with no idempotency key are not deduped. Asserted so
       nobody later "tidies" the column into NOT NULL and silently turns two
       legitimate adjustments into one. */
    const before = (await petals.balance({ name: NAME, phone: PHONE })).petals;
    await store.tx(async (tx) => {
      const c = await tx.findCustomerByPhone(E164);
      for (let i = 0; i < 2; i++) {
        await tx.appendLedger({
          customerId: c.id, delta: 1, reason: "adjusted", idemKey: null, at: new Date(clock),
        });
      }
    });
    expect((await petals.balance({ name: NAME, phone: PHONE })).petals).toBe(before + 2);
  });

  it("rolls a failed transaction all the way back", async () => {
    const before = (await petals.balance({ name: NAME, phone: PHONE })).petals;
    await expect(store.tx(async (tx) => {
      const c = await tx.findCustomerByPhone(E164);
      await tx.appendLedger({
        customerId: c.id, delta: 500, reason: "adjusted", idemKey: "rollback-me", at: new Date(clock),
      });
      throw new Error("something went wrong after the write");
    })).rejects.toThrow(/something went wrong/);
    expect((await petals.balance({ name: NAME, phone: PHONE })).petals).toBe(before);
  });

  it("expires a held reservation against real timestamptz comparison", async () => {
    const bal = (await petals.balance({ name: NAME, phone: PHONE })).petals;
    await petals.openOrder({
      name: NAME, phone: PHONE, orderId: "EXP-1", rewardId: "r-side", cost: 120,
    });
    expect((await petals.balance({ name: NAME, phone: PHONE })).petals).toBe(bal - 120);

    clock += RESERVATION_TTL_MS + 60_000;
    expect((await petals.balance({ name: NAME, phone: PHONE })).petals).toBe(bal);
    clock -= RESERVATION_TTL_MS + 60_000;
  });

  it("settles and credits the earnable exactly once", async () => {
    const bal = (await petals.balance({ name: NAME, phone: PHONE })).petals;
    await petals.openOrder({
      name: NAME, phone: PHONE, orderId: "SET-1", rewardId: "r-5off", cost: 100, earnable: 15,
    });
    expect(await petals.settle("SET-1")).toMatchObject({ settled: true, credited: 15 });
    expect(await petals.settle("SET-1")).toMatchObject({ settled: false });
    expect((await petals.balance({ name: NAME, phone: PHONE })).petals).toBe(bal - 100 + 15);
  });

  /* ---- the one that needed a real database ---- */

  it("uses the locking form of the customer lookup", async () => {
    /* The source half. The behaviour half below proves what the lock DOES; this
       proves the store is the thing using it, so the two cannot drift apart
       without one of them failing. */
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(process.cwd(), "server/petals/store.pg.js"), "utf8");
    expect(src).toMatch(/SELECT \* FROM petals_customer WHERE phone = \$1 FOR UPDATE/);
  });

  it("overdraws WITHOUT the row lock and does not WITH it", async () => {
    /* Driven through raw clients rather than two calls to openOrder, because
       two calls do not interleave: the first transaction finishes before the
       second starts, and the test passes whether the lock is there or not. I
       wrote it that way first and it proved nothing.

       This replays the exact statement sequence openOrder performs, with the
       reads forced to happen before either write — which is what two customers
       tapping "place order" in the same second actually produces. Run both
       ways, so it can never pass vacuously: no lock must overdraw, lock must
       not. */
    const pgmod = await import("pg");
    const { Client } = pgmod.default ?? pgmod;

    const attempt = async (useLock) => {
      const open = async () => {
        const c = new Client({ connectionString: URL_ });
        await c.connect();
        await c.query(`SET search_path TO ${schema}`);
        return c;
      };
      const admin = await open(), A = await open(), B = await open();
      const phone = `+1999${String(Date.now()).slice(-7)}`;
      await admin.query("INSERT INTO petals_customer (phone, name) VALUES ($1,'Race Case')", [phone]);
      const { rows: [cust] } = await admin.query("SELECT id FROM petals_customer WHERE phone=$1", [phone]);
      await admin.query(
        "INSERT INTO petals_ledger (customer_id, delta, reason, idem_key) VALUES ($1,200,'adjusted',$2)",
        [cust.id, `seed:${phone}`]);

      const lookup = useLock
        ? "SELECT * FROM petals_customer WHERE phone = $1 FOR UPDATE"
        : "SELECT * FROM petals_customer WHERE phone = $1";
      const bal = async (cl) => Number((await cl.query(
        "SELECT COALESCE(SUM(delta),0) AS p FROM petals_ledger WHERE customer_id=$1", [cust.id])).rows[0].p);
      const hold = (cl, o) => cl.query(
        `INSERT INTO petals_ledger (customer_id,delta,reason,order_id,reward_id,idem_key)
         VALUES ($1,-120,'reserved',$2,'r-side',$3)`, [cust.id, o, `reserve:${o}`]);

      await A.query("BEGIN");
      await B.query("BEGIN");
      await A.query(lookup, [phone]);
      const readA = await bal(A);

      /* B's lookup blocks here when the lock is on, and sails through when it
         is off. Either way the test continues — `bPending` is how we tell. */
      let bDone = false;
      const bTurn = (async () => { await B.query(lookup, [phone]); bDone = true; return bal(B); })();
      await new Promise((r) => setTimeout(r, 250));
      const bBlocked = !bDone;

      if (readA >= 120) await hold(A, `A-${phone}`);
      await A.query("COMMIT");
      const readB = await bTurn;
      let opened = readA >= 120 ? 1 : 0;
      if (readB >= 120) { await hold(B, `B-${phone}`); opened += 1; }
      await B.query("COMMIT");

      const final = await bal(admin);
      for (const c of [admin, A, B]) await c.end();
      return { bBlocked, readA, readB, final, opened };
    };

    const unlocked = await attempt(false);
    const locked = await attempt(true);

    // Without the lock: both read the full balance and both hold. Overdrawn.
    expect(unlocked.bBlocked, "an unlocked lookup does not wait").toBe(false);
    expect(unlocked.readB, "both transactions see the full balance").toBe(200);
    expect(unlocked.opened).toBe(2);
    expect(unlocked.final, "this is the bug: -40").toBe(-40);

    // With it: B waits, then sees the hold, and cannot afford a second.
    expect(locked.bBlocked, "a locked lookup makes the second wait").toBe(true);
    expect(locked.readB, "B sees A's hold once A commits").toBe(80);
    expect(locked.opened).toBe(1);
    expect(locked.final).toBe(80);
  });
});
