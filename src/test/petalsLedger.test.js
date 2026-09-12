import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStore } from "../../server/petals/store.memory.js";
import {
  createPetals, normalisePhone, normaliseName, PetalsError, RESERVATION_TTL_MS,
} from "../../server/petals/ledger.js";

/* ============================================================================
   PETALS, SERVER-SIDE

   The balance used to be one JSON blob on the customer's phone. A reinstall
   wiped it with no record anywhere, and staff took the complaint with nothing
   to look it up in.

   Two properties matter more than anything else here, and both are about money
   behaving like money:

   1. NOTHING IS EVER CREDITED TWICE. Payment can be reported by the tracking
      screen's poll AND by the launch sweep, and the migration can be retried by
      an app that lost its response. Every write carries a deterministic key
      with a unique constraint behind it.

   2. A VOIDED ORDER GIVES THE PETALS BACK. Spending used to deduct the moment
      a customer tapped redeem, so an order voided at the register cost them the
      food AND the Petals with nothing to restore them. Reserve on order, settle
      on payment, release on void — the mirror of how earning already worked.
   ============================================================================ */

const NAME = "Nevaeh Reid";
const PHONE = "3478599413";

let store, petals, clock;
const at = (ms) => { clock = ms; };

beforeEach(() => {
  clock = Date.UTC(2026, 8, 12, 12, 0);
  store = createMemoryStore();
  petals = createPetals({ store, now: () => clock });
});

/** Put a real balance on the account the way the app will: a paid order. */
const earn = (n, orderId = `ORD-${n}`) =>
  petals.credit({ phone: PHONE, name: NAME, orderId, petals: n });

describe("a phone number is one customer, however it was typed", () => {
  it("stores E.164 and accepts the shapes a keyboard produces", () => {
    for (const input of ["3478599413", "(347) 859-9413", "347-859-9413", "13478599413", "+1 347 859 9413"]) {
      expect(normalisePhone(input), input).toBe("+13478599413");
    }
  });

  it("refuses anything that is not a 10-digit US number", () => {
    for (const bad of ["", null, "12345", "not a phone", "447700900000"]) {
      expect(normalisePhone(bad), String(bad)).toBeNull();
    }
  });

  it("compares names loosely, because a phone keyboard is not a form", () => {
    /* Anything stricter turns a real customer away from their own balance. The
       name is a speed bump against strangers, not a password. */
    expect(normaliseName("Nevaeh  REID ")).toBe(normaliseName("nevaeh reid"));
  });
});

describe("claiming a balance", () => {
  it("creates the customer and starts at zero", async () => {
    expect(await petals.claim({ name: NAME, phone: PHONE })).toEqual({ petals: 0, known: true });
  });

  it("needs the name to match, not just the number", async () => {
    await petals.claim({ name: NAME, phone: PHONE });
    await expect(petals.claim({ name: "Someone Else", phone: PHONE }))
      .rejects.toMatchObject({ code: "NAME_MISMATCH" });
  });

  it("reports an unknown number as unknown rather than inventing an account", async () => {
    expect(await petals.balance({ name: NAME, phone: "2125550000" }))
      .toEqual({ petals: 0, known: false });
  });

  it("will not show a balance to a mistyped name", async () => {
    await earn(40);
    await expect(petals.balance({ name: "Someone Else", phone: PHONE }))
      .rejects.toMatchObject({ code: "NAME_MISMATCH" });
  });
});

describe("migrating a balance off a device", () => {
  it("carries it across once, and only once, however many times it is tried", async () => {
    /* The app may retry this — a lost response looks identical to a failure.
       The unique key is what makes a retry safe rather than doubling. */
    expect(await petals.claim({ name: NAME, phone: PHONE, deviceBalance: 90 }))
      .toMatchObject({ petals: 90 });
    expect(await petals.claim({ name: NAME, phone: PHONE, deviceBalance: 90 }))
      .toMatchObject({ petals: 90 });
    expect(await petals.claim({ name: NAME, phone: PHONE, deviceBalance: 500 }))
      .toMatchObject({ petals: 90 });
  });

  it("records it as an adjustment, so it is auditable afterwards", async () => {
    await petals.claim({ name: NAME, phone: PHONE, deviceBalance: 90 });
    const rows = store.__rows.ledger.filter((l) => l.reason === "adjusted");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ delta: 90, idemKey: "migrate:+13478599413" });
  });

  it("ignores a nonsense device balance rather than trusting the arithmetic", async () => {
    for (const junk of [-50, "abc", null, undefined]) {
      const s = createMemoryStore();
      const p = createPetals({ store: s, now: () => clock });
      expect(await p.claim({ name: NAME, phone: PHONE, deviceBalance: junk }))
        .toMatchObject({ petals: 0 });
    }
  });
});

describe("earning is credited once per order", () => {
  it("credits a paid order", async () => {
    expect(await earn(20, "ORD-1")).toMatchObject({ credited: 20, petals: 20 });
  });

  it("credits the same order once, however many times payment is reported", async () => {
    /* The tracking screen polls AND the launch sweep asks. Both will report the
       same payment, and they must not both pay. */
    await earn(20, "ORD-1");
    expect(await earn(20, "ORD-1")).toMatchObject({ credited: 0 });
    expect((await petals.balance({ name: NAME, phone: PHONE })).petals).toBe(20);
  });

  it("credits different orders separately", async () => {
    await earn(20, "ORD-1");
    await earn(15, "ORD-2");
    expect((await petals.balance({ name: NAME, phone: PHONE })).petals).toBe(35);
  });

  it("credits nothing for a zero-value order", async () => {
    expect(await earn(0, "ORD-X")).toMatchObject({ credited: 0 });
  });
});

describe("reserve on order, deduct on payment, release on void", () => {
  beforeEach(async () => { await earn(200, "SEED"); });

  it("holds the cost when the order is created", async () => {
    const r = await petals.reserve({
      phone: PHONE, name: NAME, orderId: "ORD-A", rewardId: "r-side", cost: 120, amountCents: 600,
    });
    expect(r.reserved).toBe(true);
    expect(r.petals).toBe(80);            // held, so it cannot be spent twice
    expect(r.reservation.state).toBe("held");
  });

  it("settles on payment without deducting a second time", async () => {
    /* The negative ledger row already exists from the reservation. Writing
       another here is how a customer gets charged twice for one reward. */
    await petals.reserve({ phone: PHONE, name: NAME, orderId: "ORD-A", rewardId: "r-side", cost: 120 });
    expect(await petals.settle("ORD-A")).toEqual({ settled: true, state: "settled" });
    expect((await petals.balance({ name: NAME, phone: PHONE })).petals).toBe(80);
  });

  it("gives the Petals back when the order is voided", async () => {
    await petals.reserve({ phone: PHONE, name: NAME, orderId: "ORD-A", rewardId: "r-side", cost: 120 });
    expect(await petals.release("ORD-A")).toMatchObject({ released: true, petals: 200 });
  });

  it("cannot release a reward that was already paid for", async () => {
    await petals.reserve({ phone: PHONE, name: NAME, orderId: "ORD-A", rewardId: "r-side", cost: 120 });
    await petals.settle("ORD-A");
    expect(await petals.release("ORD-A")).toMatchObject({ released: false, state: "settled" });
    expect((await petals.balance({ name: NAME, phone: PHONE })).petals).toBe(80);
  });

  it("cannot release twice and hand out the Petals again", async () => {
    await petals.reserve({ phone: PHONE, name: NAME, orderId: "ORD-A", rewardId: "r-side", cost: 120 });
    await petals.release("ORD-A");
    expect(await petals.release("ORD-A")).toMatchObject({ released: false });
    expect((await petals.balance({ name: NAME, phone: PHONE })).petals).toBe(200);
  });

  it("treats a repeated reservation for one order as the retry it is", async () => {
    const a = await petals.reserve({ phone: PHONE, name: NAME, orderId: "ORD-A", rewardId: "r-side", cost: 120 });
    const b = await petals.reserve({ phone: PHONE, name: NAME, orderId: "ORD-A", rewardId: "r-side", cost: 120 });
    expect(a.reserved).toBe(true);
    expect(b.reserved).toBe(false);
    expect((await petals.balance({ name: NAME, phone: PHONE })).petals).toBe(80);
  });

  it("refuses a reward the balance cannot pay for", async () => {
    await expect(petals.reserve({
      phone: PHONE, name: NAME, orderId: "ORD-B", rewardId: "r-plate", cost: 350,
    })).rejects.toMatchObject({ code: "INSUFFICIENT_PETALS", available: 200, needed: 350 });
  });

  it("stops a second reward being held while the first is still held", async () => {
    // 200 on the balance, two 120 rewards: the second must not fit.
    await petals.reserve({ phone: PHONE, name: NAME, orderId: "ORD-A", rewardId: "r-side", cost: 120 });
    await expect(petals.reserve({
      phone: PHONE, name: NAME, orderId: "ORD-B", rewardId: "r-side", cost: 120,
    })).rejects.toMatchObject({ code: "INSUFFICIENT_PETALS" });
  });

  it("refuses a reservation against a number with no balance", async () => {
    await expect(petals.reserve({
      phone: "2125550000", name: NAME, orderId: "ORD-C", rewardId: "r-side", cost: 120,
    })).rejects.toMatchObject({ code: "NO_BALANCE" });
  });

  it("refuses a reservation when the name does not match", async () => {
    await expect(petals.reserve({
      phone: PHONE, name: "Someone Else", orderId: "ORD-D", rewardId: "r-side", cost: 120,
    })).rejects.toMatchObject({ code: "NAME_MISMATCH" });
  });
});

describe("the customer who never came back", () => {
  /* Staff do not void an abandoned order; they just leave it. So the order sits
     open in Clover forever and the hold would sit held forever, with no event
     to release it. A day is the limit, released lazily on the next read — no
     cron to monitor, and the only person who cares is the one looking. */
  beforeEach(async () => { await earn(200, "SEED"); });

  it("releases a hold older than a day, on the next balance read", async () => {
    await petals.reserve({ phone: PHONE, name: NAME, orderId: "ORD-A", rewardId: "r-side", cost: 120 });
    expect((await petals.balance({ name: NAME, phone: PHONE })).petals).toBe(80);

    at(clock + RESERVATION_TTL_MS + 60_000);
    expect((await petals.balance({ name: NAME, phone: PHONE })).petals).toBe(200);
    expect(store.__rows.reservations[0].state).toBe("released");
  });

  it("keeps holding it inside the day, because the order is still live", async () => {
    await petals.reserve({ phone: PHONE, name: NAME, orderId: "ORD-A", rewardId: "r-side", cost: 120 });
    at(clock + 23 * 60 * 60_000);
    expect((await petals.balance({ name: NAME, phone: PHONE })).petals).toBe(80);
  });

  it("releases an expired hold once, not once per read", async () => {
    await petals.reserve({ phone: PHONE, name: NAME, orderId: "ORD-A", rewardId: "r-side", cost: 120 });
    at(clock + RESERVATION_TTL_MS + 60_000);
    await petals.balance({ name: NAME, phone: PHONE });
    await petals.balance({ name: NAME, phone: PHONE });
    expect((await petals.balance({ name: NAME, phone: PHONE })).petals).toBe(200);
  });

  it("still settles an expired-then-paid order without double-charging", async () => {
    /* The awkward case: the hold expired, the Petals went back, and THEN the
       customer turned up and paid. The reward was given away — but the balance
       must not go negative behind their back, and settle must not re-deduct. */
    await petals.reserve({ phone: PHONE, name: NAME, orderId: "ORD-A", rewardId: "r-side", cost: 120 });
    at(clock + RESERVATION_TTL_MS + 60_000);
    await petals.balance({ name: NAME, phone: PHONE });      // releases it
    expect(await petals.settle("ORD-A")).toMatchObject({ settled: false, state: "released" });
    expect((await petals.balance({ name: NAME, phone: PHONE })).petals).toBe(200);
  });
});

describe("the ledger is the balance", () => {
  it("adds up to what the reads report, every time", async () => {
    await earn(100, "O1");
    await petals.reserve({ phone: PHONE, name: NAME, orderId: "O2", rewardId: "r-drink", cost: 70 });
    await petals.settle("O2");
    await earn(50, "O3");

    const rows = store.__rows.ledger;
    const sum = rows.reduce((n, l) => n + l.delta, 0);
    expect(sum).toBe(80);
    expect((await petals.balance({ name: NAME, phone: PHONE })).petals).toBe(80);
  });

  it("records a reason on every row, so a balance can be explained", async () => {
    await earn(100, "O1");
    await petals.reserve({ phone: PHONE, name: NAME, orderId: "O2", rewardId: "r-drink", cost: 70 });
    await petals.release("O2");
    expect(store.__rows.ledger.map((l) => l.reason)).toEqual(["earned", "reserved", "released"]);
  });

  it("never rewrites or deletes a row", async () => {
    await earn(100, "O1");
    const before = JSON.stringify(store.__rows.ledger[0]);
    await petals.reserve({ phone: PHONE, name: NAME, orderId: "O2", rewardId: "r-drink", cost: 70 });
    await petals.release("O2");
    expect(JSON.stringify(store.__rows.ledger[0])).toBe(before);
  });
});

describe("bad input is refused rather than guessed at", () => {
  it("rejects a malformed phone on every entry point", async () => {
    for (const call of [
      () => petals.balance({ name: NAME, phone: "nope" }),
      () => petals.claim({ name: NAME, phone: "nope" }),
      () => petals.reserve({ name: NAME, phone: "nope", orderId: "O", rewardId: "r-side", cost: 1 }),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(PetalsError);
    }
  });

  it("needs a name to claim", async () => {
    await expect(petals.claim({ name: "   ", phone: PHONE }))
      .rejects.toMatchObject({ code: "NAME_REQUIRED" });
  });

  it("does nothing at all for a settle or release of an unknown order", async () => {
    expect(await petals.settle("NOPE")).toMatchObject({ settled: false });
    expect(await petals.release("NOPE")).toMatchObject({ released: false });
  });
});
