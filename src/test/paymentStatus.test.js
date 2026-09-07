import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../server/app.js";
import { __resetRateLimit } from "../../server/guard.js";
import {
  paymentStatus, amountPaid, loyaltyConfig, __resetLoyalty, __resetPrinters,
  CloverError,
} from "../../server/clover.js";
import { pointsFor, cloverEarnRate } from "../lib/loyalty.js";

/* ============================================================================
   "HAS IT BEEN PAID FOR?"

   The app collects no money, so Clover is the only thing that can answer this,
   and loyalty points hang on the answer. The bias throughout is deliberate: a
   wrong "yes" gives points away for food nobody paid for, a wrong "no" just
   means the customer's screen waits another thirty seconds.
   ============================================================================ */

const OPEN = new Date(2026, 6, 27, 12, 0);
const CUSTOMER = { name: "Nevaeh Reid", phone: "3478599413" };
const CART = [{ name: "Jerk Chicken", itemId: "SJGN0N254K8KE", qty: 1, price: 18, modifiers: [] }];

function proxy(over = {}) {
  const clover = {
    merchant: vi.fn().mockResolvedValue({ id: "M" }),
    createOrder: vi.fn().mockResolvedValue({ id: "CLV-9", total: 2000 }),
    getOrder: vi.fn().mockResolvedValue({ id: "CLV-9", state: "open", total: 2000 }),
    printers: vi.fn().mockResolvedValue({ elements: [{ uuid: "P1", type: "MY_LOCAL" }] }),
    printEvent: vi.fn().mockResolvedValue({}),
    findCustomerByPhone: vi.fn().mockResolvedValue({ elements: [] }),
    createCustomer: vi.fn().mockResolvedValue({ id: "C1" }),
    attachCustomer: vi.fn().mockResolvedValue({}),
    sendOrderMessage: vi.fn().mockResolvedValue({}),
    loyaltyProgram: vi.fn().mockRejectedValue(new CloverError(405, "405 GET not allowed.", {})),
    loyaltyTiers: vi.fn().mockRejectedValue(new CloverError(405, "405 GET not allowed.", {})),
    items: vi.fn(), setStock: vi.fn(), charge: vi.fn(), fulfillOrder: vi.fn(),
    ...over,
  };
  return {
    clover,
    agent: request(createApp({
      clover, catalog: async () => ({}), now: () => OPEN,
      printTicket: async () => ({ printed: true, printer: null, printError: null }),
    })),
  };
}

beforeEach(() => { __resetRateLimit(); __resetLoyalty(); __resetPrinters(); vi.clearAllMocks(); });

describe("reading payment state off a Clover order", () => {
  it("says paid when Clover's summary says PAID", () => {
    expect(paymentStatus({ paymentState: "PAID", total: 2000 }).paid).toBe(true);
  });

  it("says paid when the payments add up, even with the summary still OPEN", () => {
    /* A split payment leaves paymentState OPEN while the money is all there.
       Reading only the summary would keep the customer waiting forever. */
    const order = {
      paymentState: "OPEN", total: 2000,
      payments: { elements: [{ amount: 1200 }, { amount: 800 }] },
    };
    expect(paymentStatus(order).paid).toBe(true);
    expect(amountPaid(order)).toBe(2000);
  });

  it("does not say paid when the payments fall short", () => {
    const order = { paymentState: "OPEN", total: 2000, payments: { elements: [{ amount: 1200 }] } };
    expect(paymentStatus(order).paid).toBe(false);
  });

  it("ignores a failed payment attempt", () => {
    const order = {
      paymentState: "OPEN", total: 2000,
      payments: { elements: [{ amount: 2000, result: "FAIL" }] },
    };
    expect(amountPaid(order)).toBe(0);
    expect(paymentStatus(order).paid).toBe(false);
  });

  it("subtracts a refund", () => {
    const order = {
      paymentState: "OPEN", total: 2000,
      payments: { elements: [{ amount: 2000, refunds: { elements: [{ amount: 2000 }] } }] },
    };
    expect(amountPaid(order)).toBe(0);
    expect(paymentStatus(order).paid).toBe(false);
  });

  it("never reads a zero-total order with no payments as paid in full", () => {
    // 0 >= 0 is true, which would hand out points for nothing.
    expect(paymentStatus({ paymentState: "OPEN", total: 0 }).paid).toBe(false);
  });

  it("treats a deleted order as voided and never as paid", () => {
    const deleted = { paymentState: "PAID", total: 2000, deletedTime: 1770000000000 };
    expect(paymentStatus(deleted).voided).toBe(true);
    expect(paymentStatus(deleted).paid).toBe(false);

    const byState = { state: "deleted", paymentState: "PAID", total: 2000 };
    expect(paymentStatus(byState).paid).toBe(false);
  });

  it("has nothing to say about an order it was given nothing about", () => {
    expect(paymentStatus(undefined).paid).toBe(false);
    expect(paymentStatus({}).paid).toBe(false);
  });
});

describe("GET /orders/:id/status", () => {
  it("reports an unpaid order as open and not settled", async () => {
    const { agent } = proxy();
    const r = await agent.get("/api/clover/orders/CLV-9/status").expect(200);
    expect(r.body.paid).toBe(false);
    expect(r.body.settled).toBe(false);
  });

  it("reports a paid order as settled, so the client can stop polling", async () => {
    const { agent } = proxy({
      getOrder: vi.fn().mockResolvedValue({
        id: "CLV-9", state: "locked", paymentState: "PAID", total: 2000,
        payments: { elements: [{ amount: 2000 }] },
      }),
    });
    const r = await agent.get("/api/clover/orders/CLV-9/status").expect(200);
    expect(r.body.paid).toBe(true);
    expect(r.body.settled).toBe(true);
    expect(r.body.amountPaid).toBe(2000);
  });

  it("turns a 404 into a voided answer rather than an error", async () => {
    /* An order deleted at the register 404s. That is the answer — void — not a
       failure, and the client must stop polling and award nothing. */
    const { agent } = proxy({
      getOrder: vi.fn().mockRejectedValue(new CloverError(404, "Not found", {})),
    });
    const r = await agent.get("/api/clover/orders/GONE/status").expect(200);
    expect(r.body.voided).toBe(true);
    expect(r.body.paid).toBe(false);
    expect(r.body.settled).toBe(true);
  });

  it("still reports a real outage as an outage", async () => {
    const { agent } = proxy({
      getOrder: vi.fn().mockRejectedValue(new CloverError(503, "Clover is down", {})),
    });
    await agent.get("/api/clover/orders/CLV-9/status").expect(503);
  });

  it("asks Clover for the payments, not just the order summary", async () => {
    const { agent, clover } = proxy();
    await agent.get("/api/clover/orders/CLV-9/status").expect(200);
    expect(clover.getOrder).toHaveBeenCalledWith("CLV-9");
  });
});

describe("placing an order never marks it paid", () => {
  it("returns paid:false, because nothing was collected", async () => {
    const { agent } = proxy();
    const r = await agent.post("/api/clover/orders")
      .send({ cart: CART, customer: CUSTOMER, orderNumber: "FL-1" })
      .expect(200);

    expect(r.body.paid).toBe(false);
    // And no points figure rides along — the server does not award them either.
    expect(r.body).not.toHaveProperty("points");
    expect(r.body).not.toHaveProperty("pointsAwarded");
  });
});

/* ============================================================================
   WHOSE LOYALTY RULES

   Probed against the live merchant: every loyalty path answers `405 GET not
   allowed`, which is exactly what Clover says for a path it does not route —
   a made-up endpoint returns the identical response. So "no programme" is the
   normal case and must never look like a fault.
   ============================================================================ */
describe("Clover loyalty detection", () => {
  it("reports no programme when Clover 405s the loyalty endpoints", async () => {
    const cfg = await loyaltyConfig({ client: proxy().clover, force: true });
    expect(cfg.configured).toBe(false);
    expect(cfg.reason).toBe("NO_PROGRAM");
  });

  it("treats a 404 the same way", async () => {
    const { clover } = proxy({
      loyaltyProgram: vi.fn().mockRejectedValue(new CloverError(404, "Not found", {})),
    });
    expect((await loyaltyConfig({ client: clover, force: true })).reason).toBe("NO_PROGRAM");
  });

  it("tells a lookup failure apart from an absent programme", async () => {
    const { clover } = proxy({
      loyaltyProgram: vi.fn().mockRejectedValue(new CloverError(500, "boom", {})),
    });
    const cfg = await loyaltyConfig({ client: clover, force: true });
    expect(cfg.configured).toBe(false);
    expect(cfg.reason).toBe("LOOKUP_FAILED");
  });

  it("reports an empty body as no programme, not as a programme", async () => {
    const { clover } = proxy({ loyaltyProgram: vi.fn().mockResolvedValue({}) });
    expect((await loyaltyConfig({ client: clover, force: true })).configured).toBe(false);
  });

  it("picks up a real programme and its tiers when the merchant has one", async () => {
    const { clover } = proxy({
      loyaltyProgram: vi.fn().mockResolvedValue({ id: "LP1", name: "Flourish Points", pointsPerDollar: 2 }),
      loyaltyTiers: vi.fn().mockResolvedValue({ elements: [{ id: "T1", name: "Gold" }] }),
    });
    const cfg = await loyaltyConfig({ client: clover, force: true });
    expect(cfg.configured).toBe(true);
    expect(cfg.program.pointsPerDollar).toBe(2);
    expect(cfg.tiers).toHaveLength(1);
  });

  it("keeps a programme whose tiers cannot be read", async () => {
    const { clover } = proxy({
      loyaltyProgram: vi.fn().mockResolvedValue({ id: "LP1" }),
      loyaltyTiers: vi.fn().mockRejectedValue(new CloverError(500, "boom", {})),
    });
    const cfg = await loyaltyConfig({ client: clover, force: true });
    expect(cfg.configured).toBe(true);
    expect(cfg.tiers).toEqual([]);
  });

  it("caches, so every order does not re-ask", async () => {
    const { clover } = proxy({ loyaltyProgram: vi.fn().mockResolvedValue({ id: "LP1" }) });
    await loyaltyConfig({ client: clover, force: true });
    await loyaltyConfig({ client: clover });
    await loyaltyConfig({ client: clover });
    expect(clover.loyaltyProgram).toHaveBeenCalledTimes(1);
  });

  it("says which scheme is in force over HTTP", async () => {
    const { agent } = proxy();
    const r = await agent.get("/api/clover/loyalty").expect(200);
    expect(r.body.source).toBe("in-app");
    expect(r.body.configured).toBe(false);
  });

  it("says clover when the merchant has a programme", async () => {
    const { agent } = proxy({
      loyaltyProgram: vi.fn().mockResolvedValue({ id: "LP1", pointsPerDollar: 2 }),
      loyaltyTiers: vi.fn().mockResolvedValue({ elements: [] }),
    });
    const r = await agent.get("/api/clover/loyalty").expect(200);
    expect(r.body.source).toBe("clover");
  });
});

/* ============================================================================
   THE EARN RATE

   Clover's rules win when the merchant has a programme. But this merchant has
   none, so that branch has never run against a live programme — which is
   exactly why `cloverEarnRate` returns null instead of guessing. A rate
   invented from a field name that meant something else would quietly credit
   every customer the wrong number.
   ============================================================================ */
describe("which earn rate applies", () => {
  it("is one point per dollar with no Clover programme", () => {
    expect(pointsFor(20)).toBe(20);
    expect(pointsFor(20, { configured: false, program: null })).toBe(20);
  });

  it("uses Clover's rate when the programme states one we recognise", () => {
    expect(pointsFor(20, { configured: true, program: { pointsPerDollar: 2 } })).toBe(40);
    expect(pointsFor(20, { configured: true, program: { accrual: { rate: 0.5 } } })).toBe(10);
  });

  it("keeps our rate rather than guessing at a programme it cannot read", () => {
    // The honest failure: a programme is configured but its shape is unfamiliar.
    const odd = { configured: true, program: { someFieldWeHaveNeverSeen: 7 } };
    expect(cloverEarnRate(odd.program)).toBeNull();
    expect(pointsFor(20, odd)).toBe(20);
  });

  it("ignores a nonsense rate", () => {
    for (const bad of [0, -3, "lots", null, NaN, Infinity]) {
      expect(cloverEarnRate({ pointsPerDollar: bad })).toBeNull();
    }
  });

  it("never returns negative points for a discounted-to-nothing order", () => {
    expect(pointsFor(-5)).toBe(0);
  });
});
