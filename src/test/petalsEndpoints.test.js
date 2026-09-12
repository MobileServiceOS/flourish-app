import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../server/app.js";
import { createMemoryStore } from "../../server/petals/store.memory.js";
import { createPetals } from "../../server/petals/ledger.js";
import { __resetRateLimit } from "../../server/guard.js";
import { __resetPrinters } from "../../server/clover.js";

/* ============================================================================
   PETALS THROUGH THE PROXY

   The ledger arithmetic is tested in petalsLedger.test.js. This is the wiring:
   that a reward cannot be redeemed against a balance the server cannot verify,
   that the hold happens on the order and settles on payment, and that when
   Petals are switched off entirely the customer can still order.

   That last one is the decision worth protecting. The app takes no money, so an
   unreachable balance must never block an order — it blocks the REWARD, says so,
   and lets the food through.
   ============================================================================ */

const CATALOG = {
  "45KGD3ZDMT2ZY": { "Medium": { id: "MOD-OX-MED", price: 20 }, "Large": { id: "MOD-OX-LRG", price: 25 } },
  "YQWN3PKBKV9NG": { "White Rice": { id: "MOD-RICE", price: 0 } },
};
const CUSTOMER = { name: "Nevaeh Reid", phone: "3478599413" };
const CART = [{
  name: "Oxtail", itemId: "60KCQ1V22Q98M", qty: 1, price: 20,
  modifiers: [
    { gid: "45KGD3ZDMT2ZY", name: "Medium", price: 20 },
    { gid: "YQWN3PKBKV9NG", name: "White Rice", price: 0 },
  ],
}];

const OPEN = new Date(2026, 8, 14, 12, 0);   // a Monday, inside opening hours

function fakeClover(over = {}) {
  return {
    createOrder: vi.fn().mockResolvedValue({ id: "ORD-1", total: 2000 }),
    getOrder: vi.fn().mockResolvedValue({ id: "ORD-1", state: "open", total: 2000, printed: true }),
    printers: vi.fn().mockResolvedValue({ elements: [
      { uuid: "P1", name: "Station Printer", type: "MY_LOCAL" },
    ]}),
    printEvent: vi.fn().mockResolvedValue({ id: "PRINT-1" }),
    findCustomerByPhone: vi.fn().mockResolvedValue({ elements: [] }),
    createCustomer: vi.fn().mockResolvedValue({ id: "CUST-1" }),
    attachCustomer: vi.fn().mockResolvedValue({ id: "ORD-1" }),
    sendOrderMessage: vi.fn().mockResolvedValue({ id: "MSG-1" }),
    merchant: vi.fn().mockResolvedValue({ id: "M1" }),
    items: vi.fn().mockResolvedValue({ elements: [] }),
    ...over,
  };
}

let clock;
function build({ withPetals = true, clover = fakeClover() } = {}) {
  clock = OPEN.getTime();
  const store = withPetals ? createMemoryStore() : null;
  const petals = store ? createPetals({ store, now: () => clock }) : null;
  const agent = request(createApp({
    clover,
    catalog: async () => CATALOG,
    now: () => new Date(clock),
    printTicket: async () => ({ printed: true, printer: { uuid: "P1" }, printError: null }),
    appKey: "",
    petals,
  }));
  return { agent, clover, petals, store };
}

beforeEach(() => { __resetRateLimit(); __resetPrinters(); });

describe("reading a balance", () => {
  it("reports an unknown number as unknown", async () => {
    const { agent } = build();
    const r = await agent.post("/api/clover/petals/balance").send(CUSTOMER).expect(200);
    expect(r.body).toEqual({ petals: 0, known: false });
  });

  it("carries a device balance across on claim, once", async () => {
    const { agent } = build();
    await agent.post("/api/clover/petals/claim")
      .send({ ...CUSTOMER, deviceBalance: 150 }).expect(200);
    const again = await agent.post("/api/clover/petals/claim")
      .send({ ...CUSTOMER, deviceBalance: 150 }).expect(200);
    expect(again.body.petals).toBe(150);
  });

  it("refuses a mismatched name rather than showing someone else's balance", async () => {
    const { agent } = build();
    await agent.post("/api/clover/petals/claim").send({ ...CUSTOMER, deviceBalance: 50 }).expect(200);
    const r = await agent.post("/api/clover/petals/balance")
      .send({ name: "Someone Else", phone: CUSTOMER.phone }).expect(400);
    expect(r.body.code).toBe("NAME_MISMATCH");
  });

  it("refuses a phone that is not a 10-digit US number", async () => {
    const { agent } = build();
    const r = await agent.post("/api/clover/petals/balance")
      .send({ name: CUSTOMER.name, phone: "12345" }).expect(400);
    expect(r.body.code).toBe("BAD_PHONE");
  });
});

describe("redeeming needs a balance the server can verify", () => {
  it("refuses a reward when the balance is too small, before anything reaches Clover", async () => {
    const { agent, clover } = build();
    await agent.post("/api/clover/petals/claim").send({ ...CUSTOMER, deviceBalance: 50 }).expect(200);

    const r = await agent.post("/api/clover/orders")
      .send({ cart: CART, customer: CUSTOMER, rewardId: "r-5off" }).expect(409);

    expect(r.body.code).toBe("INSUFFICIENT_PETALS");
    expect(r.body).toMatchObject({ available: 50, needed: 100 });
    /* The order must not exist. A discount the customer has not got is money
       off the till that no later step can claw back. */
    expect(clover.createOrder).not.toHaveBeenCalled();
  });

  it("refuses a reward for a number with no balance at all", async () => {
    const { agent, clover } = build();
    const r = await agent.post("/api/clover/orders")
      .send({ cart: CART, customer: CUSTOMER, rewardId: "r-5off" }).expect(409);
    expect(r.body.code).toBe("NO_BALANCE");
    expect(clover.createOrder).not.toHaveBeenCalled();
  });

  it("takes the order and holds the Petals when the balance covers it", async () => {
    const { agent, clover, petals } = build();
    await agent.post("/api/clover/petals/claim").send({ ...CUSTOMER, deviceBalance: 200 }).expect(200);

    const r = await agent.post("/api/clover/orders")
      .send({ cart: CART, customer: CUSTOMER, rewardId: "r-5off" }).expect(200);

    expect(clover.createOrder).toHaveBeenCalledTimes(1);
    expect(r.body.petalsHeld).toBe(100);
    // Held, so the balance already reflects it and it cannot be spent twice.
    expect((await petals.balance(CUSTOMER)).petals).toBe(100);
  });
});

describe("held, then settled or released", () => {
  const seedAndOrder = async () => {
    const clover = fakeClover();
    const built = build({ clover });
    await built.agent.post("/api/clover/petals/claim")
      .send({ ...CUSTOMER, deviceBalance: 200 }).expect(200);
    await built.agent.post("/api/clover/orders")
      .send({ cart: CART, customer: CUSTOMER, rewardId: "r-5off" }).expect(200);
    return built;
  };

  it("settles the hold when the register reports the order paid", async () => {
    const { agent, clover, petals } = await seedAndOrder();
    clover.getOrder.mockResolvedValue({
      id: "ORD-1", state: "open", total: 2000, paymentState: "PAID",
      payments: { elements: [{ amount: 2000, result: "SUCCESS" }] },
    });
    await agent.get("/api/clover/orders/ORD-1/status").expect(200);
    /* 200 to start, 100 held for the reward, and $15 of net spend earns 15 —
       a $20 oxtail less the $5 discount. The hold is NOT deducted again here:
       its negative row was written when the order was created, and a second one
       is how a customer gets charged twice for one reward. */
    expect((await petals.balance(CUSTOMER)).petals).toBe(115);
  });

  it("earns on the net, after the discount, not on the full cart", async () => {
    const { agent, clover, petals } = await seedAndOrder();
    clover.getOrder.mockResolvedValue({
      id: "ORD-1", state: "open", total: 2000, paymentState: "PAID",
      payments: { elements: [{ amount: 2000, result: "SUCCESS" }] },
    });
    await agent.get("/api/clover/orders/ORD-1/status").expect(200);
    // 20 - 5 = 15, computed by the SERVER from the re-priced cart.
    expect((await petals.balance(CUSTOMER)).petals - (200 - 100)).toBe(15);
  });

  it("gives the Petals back when the order is voided", async () => {
    const { agent, clover, petals } = await seedAndOrder();
    clover.getOrder.mockResolvedValue({ id: "ORD-1", state: "deleted", total: 2000 });
    await agent.get("/api/clover/orders/ORD-1/status").expect(200);
    expect((await petals.balance(CUSTOMER)).petals).toBe(200);
  });

  it("gives them back when Clover 404s the order entirely", async () => {
    /* A deleted order 404s, which this proxy already treats as an answer rather
       than a failure. The customer lost the food; they must not also lose the
       reward. */
    const { CloverError } = await import("../../server/clover.js");
    const { agent, clover, petals } = await seedAndOrder();
    clover.getOrder.mockRejectedValue(new CloverError(404, "not found"));
    await agent.get("/api/clover/orders/ORD-1/status").expect(200);
    expect((await petals.balance(CUSTOMER)).petals).toBe(200);
  });

  it("settles once, however many times the status is polled", async () => {
    const { agent, clover, petals, store } = await seedAndOrder();
    clover.getOrder.mockResolvedValue({
      id: "ORD-1", state: "open", total: 2000, paymentState: "PAID",
      payments: { elements: [{ amount: 2000, result: "SUCCESS" }] },
    });
    for (let i = 0; i < 4; i++) await agent.get("/api/clover/orders/ORD-1/status").expect(200);
    expect((await petals.balance(CUSTOMER)).petals).toBe(115);
    expect(store.__rows.ledger.filter((l) => l.reason === "reserved")).toHaveLength(1);
    expect(store.__rows.ledger.filter((l) => l.reason === "earned")).toHaveLength(1);
  });
});

describe("earning, with no reward involved", () => {
  it("credits a plain paid order", async () => {
    /* The earnable is recorded when the order is created and credited when
       Clover confirms the payment — it has to survive that gap, and by then the
       cart it was computed from is gone. The client used to hold that number. */
    const clover = fakeClover();
    const { agent, petals } = build({ clover });
    await agent.post("/api/clover/petals/claim").send({ ...CUSTOMER, deviceBalance: 0 }).expect(200);
    const r = await agent.post("/api/clover/orders")
      .send({ cart: CART, customer: CUSTOMER }).expect(200);
    expect(r.body.petalsEarnable).toBe(20);

    clover.getOrder.mockResolvedValue({
      id: "ORD-1", state: "open", total: 2000, paymentState: "PAID",
      payments: { elements: [{ amount: 2000, result: "SUCCESS" }] },
    });
    await agent.get("/api/clover/orders/ORD-1/status").expect(200);
    expect((await petals.balance(CUSTOMER)).petals).toBe(20);
  });

  it("earns nothing for a number that never joined", async () => {
    /* No customer row means they have not opted in. The server does not enrol
       someone because they handed over a phone number for the ticket. */
    const clover = fakeClover();
    const { agent } = build({ clover });
    const r = await agent.post("/api/clover/orders")
      .send({ cart: CART, customer: CUSTOMER }).expect(200);
    expect(r.body.petalsEarnable).toBe(0);
  });

  it("credits nothing for an order that was voided", async () => {
    const clover = fakeClover();
    const { agent, petals } = build({ clover });
    await agent.post("/api/clover/petals/claim").send({ ...CUSTOMER, deviceBalance: 0 }).expect(200);
    await agent.post("/api/clover/orders").send({ cart: CART, customer: CUSTOMER }).expect(200);
    clover.getOrder.mockResolvedValue({ id: "ORD-1", state: "deleted", total: 2000 });
    await agent.get("/api/clover/orders/ORD-1/status").expect(200);
    expect((await petals.balance(CUSTOMER)).petals).toBe(0);
  });
});

describe("with Petals switched off, ordering still works", () => {
  /* The decision: the app takes no money, so an unreachable balance blocks the
     REWARD and never the food. */
  it("answers the balance endpoint with a code the app can act on", async () => {
    const { agent } = build({ withPetals: false });
    const r = await agent.post("/api/clover/petals/balance").send(CUSTOMER).expect(503);
    expect(r.body.code).toBe("PETALS_UNAVAILABLE");
  });

  it("still takes an order with no reward on it", async () => {
    const { agent, clover } = build({ withPetals: false });
    await agent.post("/api/clover/orders").send({ cart: CART, customer: CUSTOMER }).expect(200);
    expect(clover.createOrder).toHaveBeenCalledTimes(1);
  });

  it("applies a reward without a ledger rather than refusing the order", async () => {
    /* No balance to check and none to charge. The cap is what bounds this, and
       it is the documented behaviour for a deployment with no database — not a
       silent fallback to trusting the client for an amount. */
    const { agent, clover } = build({ withPetals: false });
    const r = await agent.post("/api/clover/orders")
      .send({ cart: CART, customer: CUSTOMER, rewardId: "r-5off" }).expect(200);
    expect(r.body.discount).toEqual({ name: "$5 off", amount: 5 });
    expect(r.body.petalsHeld).toBe(0);
    expect(clover.createOrder.mock.calls[0][0].orderCart.discounts[0].amount).toBe(-500);
  });
});

/* ============================================================================
   THE 503 PATH, FROM THE APP'S SIDE

   Petals are off in production until a DATABASE_URL exists, and that has to
   degrade cleanly rather than cost a sale. The app takes no money, so an
   unreachable balance must block the REWARD and never the food.
   ============================================================================ */

describe("the live shape today: no database", () => {
  it("reports a build marker, so the deployed version is knowable", async () => {
    /* Added because the app and the proxy ship separately and there was no way
       to tell which version was deployed — and no request can safely probe for
       it. See docs/TECH-DEBT.md #3. */
    const { agent } = build({ withPetals: false });
    const r = await agent.get("/api/clover/health").expect(200);
    expect(r.body.build).toBeTruthy();
    expect(r.body.build).toHaveProperty("version");
    expect(r.body.build).toHaveProperty("commit");
  });

  it("answers both Petals routes with 503 and a code, not a crash", async () => {
    const { agent } = build({ withPetals: false });
    for (const path of ["/api/clover/petals/balance", "/api/clover/petals/claim"]) {
      const r = await agent.post(path).send({ name: "A B", phone: "3478599413" }).expect(503);
      expect(r.body.code, path).toBe("PETALS_UNAVAILABLE");
    }
  });

  it("takes an order with a reward, at the server's own figure, with no ledger", async () => {
    /* Documented behaviour for a deployment with no database: the cap is what
       bounds it, and it is NOT a silent fallback to trusting the client for an
       amount — the amount is still computed here. */
    const { agent, clover } = build({ withPetals: false });
    const r = await agent.post("/api/clover/orders")
      .send({ cart: CART, customer: CUSTOMER, rewardId: "r-5off" }).expect(200);
    expect(r.body.discount).toEqual({ name: "$5 off", amount: 5 });
    expect(r.body.petalsHeld).toBe(0);
    expect(clover.createOrder).toHaveBeenCalledTimes(1);
  });

  it("still refuses a client-named amount with no database in play", async () => {
    const { agent, clover } = build({ withPetals: false });
    const r = await agent.post("/api/clover/orders")
      .send({ cart: CART, customer: CUSTOMER, reward: { name: "x", amount: 250 } }).expect(400);
    expect(r.body.code).toBe("REWARD_AMOUNT_NOT_ACCEPTED");
    expect(clover.createOrder).not.toHaveBeenCalled();
  });

  it("settles nothing and throws nothing when the status is polled", async () => {
    const { agent } = build({ withPetals: false });
    await agent.post("/api/clover/orders").send({ cart: CART, customer: CUSTOMER }).expect(200);
    await agent.get("/api/clover/orders/ORD-1/status").expect(200);
  });
});
