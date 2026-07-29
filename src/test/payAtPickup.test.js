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

describe("the kitchen ticket says money is still owed", () => {
  it("leads with PAY AT REGISTER", () => {
    const note = kitchenNote({ orderNumber: "FL-4821", customer: CUSTOMER, pickupLabel: "ASAP" });
    expect(note.split("\n")[0]).toBe("PICKUP ORDER — PAY AT REGISTER");
  });

  it("carries the same order number the customer sees", () => {
    const body = buildAtomicOrder({
      cart: CART, catalog: CATALOG, orderNumber: "FL-4821",
      customer: CUSTOMER, pickupLabel: "ASAP",
    });
    expect(body.orderCart.note).toContain("FL-4821");
    expect(body.orderCart.title).toContain("FL-4821");
    expect(body.orderCart.title).toContain("PAY AT REGISTER");
  });

  it("names the customer and their number, so staff can call it out", () => {
    const note = kitchenNote({ customer: CUSTOMER, pickupLabel: "7:30 PM" });
    expect(note).toContain("Nevaeh Reid");
    expect(note).toContain("3478599413");
    expect(note).toContain("Pickup: 7:30 PM");
  });

  it("shows a redeemed reward, so the register knows to take it off", () => {
    const note = kitchenNote({
      customer: CUSTOMER, pickupLabel: "ASAP",
      reward: { name: "Free side", code: "FL1234", amount: 6 },
    });
    expect(note).toContain("REWARD APPLIED: Free side (FL1234)");
    expect(note).toContain("$6.00");
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
      .send({ cart: CART, customer: CUSTOMER, orderNumber: "FL-4821", pickupLabel: "ASAP" })
      .expect(200);

    expect(r.body.success).toBe(true);
    expect(r.body.paid).toBe(false);
    expect(r.body.orderId).toBe("CLV-99");
    expect(r.body.orderNumber).toBe("FL-4821");
  });

  it("puts the customer and the number on the ticket it sends Clover", async () => {
    const { agent, clover } = proxy();
    await agent.post("/api/clover/orders")
      .send({ cart: CART, customer: CUSTOMER, orderNumber: "FL-4821", pickupLabel: "7:30 PM" })
      .expect(200);

    const note = clover.createOrder.mock.calls[0][0].orderCart.note;
    expect(note).toContain("PAY AT REGISTER");
    expect(note).toContain("FL-4821");
    expect(note).toContain("Nevaeh Reid");
    expect(note).toContain("7:30 PM");
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
