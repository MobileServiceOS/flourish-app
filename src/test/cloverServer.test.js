import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../server/app.js";
import { CloverError, __scrub } from "../../server/clover.js";
import { __resetRateLimit } from "../../server/guard.js";

const CATALOG = {
  "45KGD3ZDMT2ZY": { "Medium": { id: "MOD-OX-MED", price: 20 }, "Large": { id: "MOD-OX-LRG", price: 25 } },
  "YQWN3PKBKV9NG": { "White Rice": { id: "MOD-RICE", price: 0 }, "Seafood Mac": { id: "MOD-SFM", price: 3.5 } },
};

const CART = [{
  name: "Oxtail", itemId: "60KCQ1V22Q98M", qty: 1, price: 20, note: "no pepper",
  modifiers: [
    { gid: "45KGD3ZDMT2ZY", name: "Medium", price: 20 },
    { gid: "YQWN3PKBKV9NG", name: "White Rice", price: 0 },
  ],
}];

function fakeClover(over = {}) {
  return {
    items: vi.fn().mockResolvedValue({ elements: [
      { id: "A", name: "Oxtail", stockCount: 4 },
      { id: "B", name: "Lamb", stockCount: 0 },
      { id: "C", name: "Patty" },                       // no stock tracking
      { id: "D", name: "Secret", hidden: true, stockCount: 2 },
    ]}),
    setStock: vi.fn().mockResolvedValue({ id: "A", stockCount: 0 }),
    createOrder: vi.fn().mockResolvedValue({ id: "ORD-1", total: 2000 }),
    getOrder: vi.fn().mockResolvedValue({ id: "ORD-1", state: "open", total: 2000, printed: true }),
    printOrder: vi.fn().mockResolvedValue({ id: "PRINT-1" }),
    charge: vi.fn().mockResolvedValue({ id: "CHG-1", status: "succeeded", amount: 2178 }),
    merchant: vi.fn().mockResolvedValue({ id: "M1", name: "Flourish bx inc" }),
    findCustomerByPhone: vi.fn().mockResolvedValue({ elements: [] }),
    createCustomer: vi.fn().mockResolvedValue({ id: "CUST-1" }),
    ...over,
  };
}
const app = (clover = fakeClover()) =>
  ({ agent: request(createApp({ clover, catalog: async () => CATALOG })), clover });

beforeEach(() => {
  vi.clearAllMocks();
  // guard.js keeps its counters in a module-level map, so requests from earlier
  // tests would otherwise spend this test's budget.
  __resetRateLimit();
});

describe("health", () => {
  it("reports configuration without ever returning a token", async () => {
    const { agent } = app();
    const r = await agent.get("/api/clover/health").expect(200);
    expect(r.body.ok).toBe(true);
    expect(JSON.stringify(r.body)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
  });

  it("is only \"configured\" once Clover actually accepts the credentials", async () => {
    // Present-but-rejected credentials must not put the app in online mode:
    // it would offer a card form and then fail every call.
    const clover = fakeClover({
      merchant: vi.fn().mockRejectedValue(new CloverError(401, "401 Unauthorized", {})),
    });
    const { agent } = app(clover);
    const r = await agent.get("/api/clover/health").expect(200);
    expect(r.body.configured).toBe(false);
    expect(r.body.reason).toBe("CREDENTIALS_REJECTED");
  });

  it("reports configured when Clover answers", async () => {
    const { agent } = app();
    const r = await agent.get("/api/clover/health").expect(200);
    expect(r.body.configured).toBe(true);
    expect(r.body.reason).toBeNull();
  });
});

describe("order push", () => {
  it("creates a Clover atomic order from the cart and returns its id", async () => {
    const { agent, clover } = app();
    const r = await agent.post("/api/clover/orders")
      .send({ cart: CART, pickupLabel: "ASAP" }).expect(200);

    expect(r.body.orderId).toBe("ORD-1");
    const body = clover.createOrder.mock.calls[0][0];
    expect(body.orderCart.lineItems[0].item.id).toBe("60KCQ1V22Q98M");
    expect(body.orderCart.lineItems[0].note).toBe("no pepper");
    expect(body.orderCart.lineItems[0].modifications[0].modifier.id).toBe("MOD-OX-MED");
  });

  it("does not trust prices sent by the client", async () => {
    // Someone edits the request to claim a Large oxtail costs a penny.
    const tampered = [{ ...CART[0], price: 0.01,
      modifiers: [{ gid: "45KGD3ZDMT2ZY", name: "Large", price: 0.01 }] }];
    const { agent, clover } = app();
    await agent.post("/api/clover/orders").send({ cart: tampered }).expect(200);

    const mod = clover.createOrder.mock.calls[0][0].orderCart.lineItems[0].modifications[0];
    expect(mod.modifier.id).toBe("MOD-OX-LRG");
    expect(mod.amount).toBe(2500);        // Clover's $25, not the client's $0.01
  });

  it("sends no pre-calculated tax to Clover", async () => {
    const { agent, clover } = app();
    await agent.post("/api/clover/orders").send({ cart: CART }).expect(200);
    expect(JSON.stringify(clover.createOrder.mock.calls[0][0])).not.toMatch(/tax/i);
  });

  it("applies a redeemed reward as a negative order discount", async () => {
    const { agent, clover } = app();
    await agent.post("/api/clover/orders")
      .send({ cart: CART, reward: { name: "Free side", code: "FL1234", amount: 6 } }).expect(200);
    expect(clover.createOrder.mock.calls[0][0].orderCart.discounts)
      .toEqual([{ name: "Free side (FL1234)", amount: -600 }]);
  });

  it("refuses an order whose modifiers no longer exist rather than ringing it up free", async () => {
    const stale = [{ ...CART[0],
      modifiers: [{ gid: "45KGD3ZDMT2ZY", name: "Enormous", price: 99 }] }];
    const { agent, clover } = app();
    const r = await agent.post("/api/clover/orders").send({ cart: stale }).expect(409);

    expect(r.body.code).toBe("MODIFIER_UNRESOLVED");
    expect(clover.createOrder).not.toHaveBeenCalled();
  });

  it("rejects an empty cart", async () => {
    const { agent } = app();
    await agent.post("/api/clover/orders").send({ cart: [] }).expect(400);
  });
});

describe("print event", () => {
  it("fires after the order is created", async () => {
    const { agent, clover } = app();
    const r = await agent.post("/api/clover/orders").send({ cart: CART }).expect(200);
    expect(clover.printOrder).toHaveBeenCalledWith("ORD-1");
    expect(r.body.printed).toBe(true);
  });

  it("still confirms the order when the printer is down", async () => {
    // The order exists in Clover regardless; staff can read it off the register.
    const clover = fakeClover({
      printOrder: vi.fn().mockRejectedValue(new CloverError(500, "Printer offline", {})),
    });
    const { agent } = app(clover);
    const r = await agent.post("/api/clover/orders").send({ cart: CART }).expect(200);

    expect(r.body.orderId).toBe("ORD-1");
    expect(r.body.printed).toBe(false);
    expect(r.body.printError).toMatch(/trouble|printer/i);
  });
});

describe("payment", () => {
  it("charges the tokenized card with the tip alongside", async () => {
    const { agent, clover } = app();
    const r = await agent.post("/api/clover/pay")
      .send({ source: "tok_1", amountDollars: 21.78, tipDollars: 3, orderId: "ORD-1" }).expect(200);

    expect(r.body.chargeId).toBe("CHG-1");
    expect(clover.charge).toHaveBeenCalledWith(expect.objectContaining({
      source: "tok_1", amount: 2178, tip_amount: 300,
    }));
  });

  it("passes a decline back with its reason", async () => {
    const clover = fakeClover({
      charge: vi.fn().mockRejectedValue(new CloverError(402, "Your card was declined.", {
        error: { code: "card_declined", decline_code: "insufficient_funds" },
      })),
    });
    const { agent } = app(clover);
    const r = await agent.post("/api/clover/pay")
      .send({ source: "tok", amountDollars: 10 }).expect(402);

    expect(r.body.code).toBe("card_declined");
    expect(r.body.declineReason).toBe("insufficient_funds");
  });

  it("refuses a charge with no token or no amount", async () => {
    const { agent } = app();
    await agent.post("/api/clover/pay").send({ amountDollars: 10 }).expect(400);
    await agent.post("/api/clover/pay").send({ source: "tok", amountDollars: 0 }).expect(400);
  });
});

describe("inventory", () => {
  it("marks zero-stock items unavailable and leaves untracked ones alone", async () => {
    const { agent } = app();
    const { items } = (await agent.get("/api/clover/inventory").expect(200)).body;
    expect(items.find((i) => i.id === "A").available).toBe(true);
    expect(items.find((i) => i.id === "B").available).toBe(false);
    expect(items.find((i) => i.id === "C").available).toBe(true);
  });

  it("pushes an 86 back to Clover as stockCount 0", async () => {
    const { agent, clover } = app();
    await agent.post("/api/clover/inventory/ITEM-9/stock").send({ stockCount: 0 }).expect(200);
    expect(clover.setStock).toHaveBeenCalledWith("ITEM-9", 0);
  });

  it("rejects a nonsense stock count", async () => {
    const { agent } = app();
    await agent.post("/api/clover/inventory/X/stock").send({ stockCount: -3 }).expect(400);
    await agent.post("/api/clover/inventory/X/stock").send({ stockCount: "lots" }).expect(400);
  });
});

describe("customers", () => {
  it("creates a Clover customer and returns the id", async () => {
    const { agent, clover } = app();
    const r = await agent.post("/api/clover/customers")
      .send({ name: "Nevaeh Reid", phone: "3478599413" }).expect(200);

    expect(r.body).toEqual({ customerId: "CUST-1", existing: false });
    expect(clover.createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: "Nevaeh", lastName: "Reid", phone: "3478599413" })
    );
  });

  it("reuses an existing customer rather than duplicating them", async () => {
    const clover = fakeClover({
      findCustomerByPhone: vi.fn().mockResolvedValue({ elements: [{ id: "CUST-EXISTING" }] }),
    });
    const { agent } = app(clover);
    const r = await agent.post("/api/clover/customers")
      .send({ name: "Nevaeh Reid", phone: "3478599413" }).expect(200);

    expect(r.body).toEqual({ customerId: "CUST-EXISTING", existing: true });
    expect(clover.createCustomer).not.toHaveBeenCalled();
  });
});

describe("errors never leak the token", () => {
  it("scrubs anything bearer-shaped out of an error string", () => {
    expect(__scrub("failed: Authorization: Bearer abc123.def-456"))
      .toBe("failed: Authorization: Bearer «redacted»");
  });

  it("reports a credential rejection as a gateway fault, not the customer's fault", async () => {
    const clover = fakeClover({
      items: vi.fn().mockRejectedValue(new CloverError(401, "401 Unauthorized", {})),
    });
    const { agent } = app(clover);
    const r = await agent.get("/api/clover/inventory").expect(502);
    expect(r.body.error).toMatch(/credential/i);
  });

  it("surfaces a Clover outage as something a customer can read", async () => {
    const clover = fakeClover({
      createOrder: vi.fn().mockRejectedValue(new CloverError(503, "The restaurant's system is having trouble. Try again shortly.", {})),
    });
    const { agent } = app(clover);
    const r = await agent.post("/api/clover/orders").send({ cart: CART }).expect(503);
    expect(r.body.error).toMatch(/try again/i);
  });
});
