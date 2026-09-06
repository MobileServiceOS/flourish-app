import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { buildAtomicOrder, kitchenNote } from "../lib/cloverOrder.js";
import { createApp } from "../../server/app.js";
import { __resetRateLimit } from "../../server/guard.js";

const CATALOG = { "45KGD3ZDMT2ZY": { Medium: { id: "MOD-MED", price: 20 } } };
const CART = [{
  name: "Oxtail", itemId: "60KCQ1V22Q98M", qty: 1, price: 20, note: "no pepper",
  modifiers: [{ gid: "45KGD3ZDMT2ZY", name: "Medium", price: 20 }],
}];
const CUSTOMER = { name: "Nevaeh Reid", phone: "3478599413" };

/* There is no ASAP any more. A pickup label is always a real window, worked out
   by the server from what is in the cart. */
const WINDOW = "2:10–2:20 PM";

describe("the kitchen ticket says money is still owed", () => {
  it("leads with PAY AT REGISTER", () => {
    const note = kitchenNote({ orderNumber: "FL-4821", customer: CUSTOMER, pickupLabel: WINDOW });
    expect(note.split("\n")[0]).toBe("PICKUP ORDER — PAY AT REGISTER");
  });

  it("carries the same order number the customer sees", () => {
    const body = buildAtomicOrder({
      cart: CART, catalog: CATALOG, orderNumber: "FL-4821",
      customer: CUSTOMER, pickupLabel: WINDOW,
    });
    expect(body.orderCart.note).toContain("FL-4821");
    expect(body.orderCart.title).toContain("FL-4821");
    expect(body.orderCart.title).toContain("PAY AT REGISTER");
  });

  it("names the customer and their number, so staff can call it out", () => {
    const note = kitchenNote({ customer: CUSTOMER, pickupLabel: "7:30 PM" });
    expect(note).toContain("Nevaeh Reid");
    // Formatted the way a human reads a number off a printed ticket.
    expect(note).toContain("(347) 859-9413");
    expect(note).toContain("Pickup: 7:30 PM");
  });

  it("shows a redeemed reward, so the register knows to take it off", () => {
    /* The name is what staff need to see; the amount is on the order as a real
       Clover discount, which is what actually moves the money. Restating the
       figure on the ticket only creates something to disagree with. */
    const note = kitchenNote({
      orderNumber: "FL-4821", customer: CUSTOMER, pickupLabel: WINDOW,
      reward: { name: "Free side", code: "FL1234", amount: 6 },
    });
    expect(note).toContain("Reward: Free side");
  });

  it("attaches no payment at all — that is what leaves it owing", () => {
    const body = buildAtomicOrder({
      cart: CART, catalog: CATALOG, orderNumber: "FL-1", customer: CUSTOMER,
    });
    const json = JSON.stringify(body);
    expect(body.orderCart.payments).toBeUndefined();
    expect(json).not.toMatch(/"payment/i);
    expect(json).not.toMatch(/tender/i);
  });
});

describe("the order endpoint", () => {
  const OPEN = new Date(2026, 6, 27, 12, 0);
  function proxy() {
    __resetRateLimit();
    const clover = {
      merchant: vi.fn().mockResolvedValue({ id: "M" }),
      createOrder: vi.fn().mockResolvedValue({ id: "CLV-99", total: 2000 }),
      printOrder: vi.fn().mockResolvedValue({}),
      items: vi.fn(), getOrder: vi.fn(), setStock: vi.fn(), charge: vi.fn(),
      findCustomerByPhone: vi.fn(), createCustomer: vi.fn(),
    };
    return {
      agent: request(createApp({ clover, catalog: async () => CATALOG, now: () => OPEN })),
      clover,
    };
  }

  it("reports success and that nothing was paid", async () => {
    const { agent } = proxy();
    const r = await agent.post("/api/clover/orders")
      .send({ cart: CART, customer: CUSTOMER, orderNumber: "FL-4821", pickupLabel: WINDOW })
      .expect(200);

    expect(r.body.success).toBe(true);
    expect(r.body.paid).toBe(false);
    expect(r.body.orderId).toBe("CLV-99");
    expect(r.body.orderNumber).toBe("FL-4821");
  });

  it("puts the customer and the number on the ticket it sends Clover", async () => {
    const { agent, clover } = proxy();
    const r = await agent.post("/api/clover/orders")
      .send({ cart: CART, customer: CUSTOMER, orderNumber: "FL-4821" })
      .expect(200);

    const note = clover.createOrder.mock.calls[0][0].orderCart.note;
    expect(note).toContain("PAY AT REGISTER");
    expect(note).toContain("FL-4821");
    expect(note).toContain("Nevaeh Reid");
    expect(note).toContain("(347) 859-9413");
    /* The window on the ticket is the same string the customer was shown — the
       server hands back exactly what it printed. */
    expect(note).toContain(`Pickup: ${r.body.readyWindow.label}`);
  });

  it("refuses an order with no customer, so an anonymous ticket is impossible", async () => {
    const { agent, clover } = proxy();
    const r = await agent.post("/api/clover/orders")
      .send({ cart: CART, orderNumber: "FL-4821" })
      .expect(400);

    expect(r.body.code).toBe("CUSTOMER_REQUIRED");
    expect(r.body.missing).toEqual(["name", "phone"]);
    // Nothing reached Clover — an order nobody can be handed is worse than none.
    expect(clover.createOrder).not.toHaveBeenCalled();
  });

  it("refuses a name with no phone, and a phone with no name", async () => {
    const { agent } = proxy();
    const noPhone = await agent.post("/api/clover/orders")
      .send({ cart: CART, customer: { name: "Nevaeh Reid" } }).expect(400);
    expect(noPhone.body.missing).toEqual(["phone"]);

    const noName = await agent.post("/api/clover/orders")
      .send({ cart: CART, customer: { phone: "3478599413" } }).expect(400);
    expect(noName.body.missing).toEqual(["name"]);
  });

  it("refuses a phone that is not ten digits", async () => {
    const { agent } = proxy();
    const r = await agent.post("/api/clover/orders")
      .send({ cart: CART, customer: { name: "Nevaeh Reid", phone: "347859" } }).expect(400);
    expect(r.body.missing).toEqual(["phone"]);
  });

  it("still succeeds when the printer refuses — the order is on the register", async () => {
    const { agent, clover } = proxy();
    clover.printOrder.mockRejectedValue(new Error("printer offline"));
    const r = await agent.post("/api/clover/orders")
      .send({ cart: CART, customer: CUSTOMER, orderNumber: "FL-1" })
      .expect(200);

    expect(r.body.success).toBe(true);
    expect(r.body.printed).toBe(false);
    expect(r.body.orderId).toBe("CLV-99");
  });
});

describe("the app no longer takes card details", () => {
  it("has no card form component", async () => {
    const { existsSync } = await import("node:fs");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const HERE = dirname(fileURLToPath(import.meta.url));
    expect(existsSync(resolve(HERE, "../components/CardForm.jsx"))).toBe(false);
  });

  it("asks for no card anywhere on the checkout", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const HERE = dirname(fileURLToPath(import.meta.url));
    const co = readFileSync(resolve(HERE, "../components/CheckoutView.jsx"), "utf8");
    expect(co).not.toMatch(/CardForm|tokenize|card number/i);
    expect(co).toContain("PAY AT PICKUP");
  });
});
