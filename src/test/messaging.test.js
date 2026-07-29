import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp, confirmationMessage, readyMessage } from "../../server/app.js";
import { __resetRateLimit } from "../../server/guard.js";
import { READY_WINDOW } from "../lib/hours.js";

const OPEN = new Date(2026, 6, 27, 12, 0);
const CATALOG = { "45KGD3ZDMT2ZY": { Medium: { id: "MOD-MED", price: 20 } } };
const CART = [{
  name: "Oxtail", itemId: "60KCQ1V22Q98M", qty: 1, price: 20,
  modifiers: [{ gid: "45KGD3ZDMT2ZY", name: "Medium", price: 20 }],
}];
const CUSTOMER = { name: "Nevaeh Reid", phone: "3478599413" };

function proxy(over = {}) {
  __resetRateLimit();
  const clover = {
    merchant: vi.fn().mockResolvedValue({ id: "M" }),
    createOrder: vi.fn().mockResolvedValue({ id: "CLV-9", total: 2000 }),
    printOrder: vi.fn().mockResolvedValue({}),
    findCustomerByPhone: vi.fn().mockResolvedValue({ elements: [] }),
    createCustomer: vi.fn().mockResolvedValue({ id: "CUST-9" }),
    attachCustomer: vi.fn().mockResolvedValue({}),
    sendOrderMessage: vi.fn().mockResolvedValue({ id: "MSG-1" }),
    fulfillOrder: vi.fn().mockResolvedValue({ id: "CLV-9", state: "fulfilled" }),
    items: vi.fn(), getOrder: vi.fn(), setStock: vi.fn(), charge: vi.fn(),
    ...over,
  };
  return {
    agent: request(createApp({ clover, catalog: async () => CATALOG, now: () => OPEN })),
    clover,
  };
}

const place = (agent, body = {}) => agent.post("/api/clover/orders")
  .send({ cart: CART, customer: CUSTOMER, orderNumber: "FL-4821", pickupLabel: "ASAP", ...body });

describe("what the customer is told", () => {
  it("quotes the real ready window, not a hardcoded fifteen minutes", () => {
    expect(confirmationMessage("FL-4821")).toContain(READY_WINDOW);
    expect(confirmationMessage("FL-4821")).not.toMatch(/\b15 min\b/);
  });

  it("says where to go and that payment is on collection", () => {
    const m = confirmationMessage("FL-4821");
    expect(m).toContain("4035 Laconia Ave");
    expect(m).toMatch(/pay when you pick up/i);
    expect(m).toContain("FL-4821");
  });

  it("tells them plainly when it is ready", () => {
    const m = readyMessage("FL-4821");
    expect(m).toMatch(/ready for pickup/i);
    expect(m).toContain("4035 Laconia Ave");
    expect(m).toContain("FL-4821");
  });
});

describe("messaging on order creation", () => {
  it("finds or creates the customer and puts them on the order", async () => {
    const { agent, clover } = proxy();
    await place(agent).expect(200);

    expect(clover.findCustomerByPhone).toHaveBeenCalledWith("3478599413");
    expect(clover.createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: "Nevaeh", lastName: "Reid", phone: "3478599413" })
    );
    expect(clover.attachCustomer).toHaveBeenCalledWith("CLV-9", "CUST-9");
  });

  it("reuses an existing customer rather than making a duplicate", async () => {
    const { agent, clover } = proxy({
      findCustomerByPhone: vi.fn().mockResolvedValue({ elements: [{ id: "CUST-OLD" }] }),
    });
    await place(agent).expect(200);
    expect(clover.createCustomer).not.toHaveBeenCalled();
    expect(clover.attachCustomer).toHaveBeenCalledWith("CLV-9", "CUST-OLD");
  });

  it("sends the confirmation and reports that it went", async () => {
    const { agent, clover } = proxy();
    const r = await place(agent).expect(200);
    expect(clover.sendOrderMessage).toHaveBeenCalledWith("CLV-9", confirmationMessage("FL-4821"));
    expect(r.body.messaged).toBe(true);
  });

  it("still places the order when messaging is not on the plan", async () => {
    // The whole point of the fallback: the order matters, the text does not.
    const { agent, clover } = proxy({
      sendOrderMessage: vi.fn().mockRejectedValue(new Error("405 Method Not Allowed")),
    });
    const r = await place(agent).expect(200);
    expect(r.body.success).toBe(true);
    expect(r.body.orderId).toBe("CLV-9");
    expect(r.body.messaged).toBe(false);
    expect(clover.createOrder).toHaveBeenCalled();
  });

  it("still places the order when the customer lookup falls over", async () => {
    const { agent } = proxy({
      findCustomerByPhone: vi.fn().mockRejectedValue(new Error("boom")),
      createCustomer: vi.fn().mockRejectedValue(new Error("boom")),
    });
    const r = await place(agent).expect(200);
    expect(r.body.success).toBe(true);
  });

  it("skips messaging entirely for a guest with no phone", async () => {
    const { agent, clover } = proxy();
    await place(agent, { customer: { name: "Walk In" } }).expect(200);
    expect(clover.sendOrderMessage).not.toHaveBeenCalled();
  });
});

describe("staff marking an order ready", () => {
  it("fulfils the order and messages the customer", async () => {
    const { agent, clover } = proxy();
    const r = await agent.post("/api/clover/orders/CLV-9/ready")
      .send({ orderNumber: "FL-4821" }).expect(200);

    expect(clover.fulfillOrder).toHaveBeenCalledWith("CLV-9");
    expect(clover.sendOrderMessage).toHaveBeenCalledWith("CLV-9", readyMessage("FL-4821"));
    expect(r.body).toMatchObject({ success: true, state: "fulfilled", messaged: true });
  });

  it("still marks it ready when the message cannot be sent", async () => {
    const { agent } = proxy({
      sendOrderMessage: vi.fn().mockRejectedValue(new Error("not available")),
    });
    const r = await agent.post("/api/clover/orders/CLV-9/ready").send({}).expect(200);
    expect(r.body.success).toBe(true);
    expect(r.body.messaged).toBe(false);
  });

  it("reports a real failure to flip the order", async () => {
    const { agent } = proxy({
      fulfillOrder: vi.fn().mockRejectedValue(new Error("gone")),
    });
    await agent.post("/api/clover/orders/CLV-9/ready").send({}).expect(500);
  });
});
