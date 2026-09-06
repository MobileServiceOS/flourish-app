import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../../server/app.js";
import { __resetRateLimit } from "../../server/guard.js";
import { __resetPrinters } from "../../server/clover.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

const CATALOG = {};
const item = (itemId, name) => ({ itemId, name, qty: 1, price: 20, modifiers: [] });

const JERK = item("SJGN0N254K8KE", "Jerk Chicken");   // 15 min
const SALMON = item("H9520PFNBT2NY", "Salmon");       // 30 min, cooked to order
const DRINK = item("D7MBX5PWRCGCE", "Drink");         // no prep
const CUSTOMER = { name: "Nevaeh Reid", phone: "3478599413" };

function proxy(now = new Date(2026, 6, 27, 12, 0)) {
  const clover = {
    merchant: vi.fn().mockResolvedValue({ id: "M" }),
    createOrder: vi.fn().mockResolvedValue({ id: "CLV-9", total: 2000 }),
    printers: vi.fn().mockResolvedValue({ elements: [
      { uuid: "ZVZ9PRJ255V90", name: "Station Printer", type: "MY_LOCAL" },
    ]}),
    printEvent: vi.fn().mockResolvedValue({}),
    findCustomerByPhone: vi.fn().mockResolvedValue({ elements: [] }),
    createCustomer: vi.fn().mockResolvedValue({ id: "CUST-9" }),
    attachCustomer: vi.fn().mockResolvedValue({}),
    sendOrderMessage: vi.fn().mockResolvedValue({}),
    items: vi.fn(), getOrder: vi.fn(), setStock: vi.fn(), charge: vi.fn(), fulfillOrder: vi.fn(),
  };
  return {
    clover,
    agent: request(createApp({ clover, catalog: async () => CATALOG, now: () => now })),
  };
}

const quote = (agent, cart) => agent.post("/api/clover/quote").send({ cart });

beforeEach(() => { __resetRateLimit(); __resetPrinters(); });

describe("the server decides when food is ready", () => {
  it("quotes fifteen minutes for a steam-table plate", async () => {
    const { agent } = proxy();
    const r = await quote(agent, [JERK]).expect(200);
    expect(r.body.prepMinutes).toBe(15);
    expect(r.body.label).toBe("12:15–12:25 PM");
  });

  it("quotes thirty for anything cooked to order", async () => {
    const { agent } = proxy();
    const r = await quote(agent, [SALMON]).expect(200);
    expect(r.body.prepMinutes).toBe(30);
    expect(r.body.label).toBe("12:30–12:40 PM");
  });

  it("takes the slowest plate in a mixed cart", async () => {
    const { agent } = proxy();
    const r = await quote(agent, [JERK, SALMON, DRINK]).expect(200);
    expect(r.body.prepMinutes).toBe(30);
  });

  it("offers slots that start after this cart's prep, not a flat fifteen", async () => {
    const { agent } = proxy();
    const fast = await quote(agent, [JERK]).expect(200);
    const slow = await quote(agent, [SALMON]).expect(200);

    expect(fast.body.slots[0].label).toBe("12:15 PM");
    expect(slow.body.slots[0].label).toBe("12:30 PM");
  });

  it("refuses an empty cart rather than quoting nothing", async () => {
    const { agent } = proxy();
    await quote(agent, []).expect(400);
  });

  it("says the shop is shut, and when it opens, without a window to sell", async () => {
    const { agent } = proxy(new Date(2026, 6, 27, 23, 30));
    const r = await quote(agent, [JERK]).expect(200);
    expect(r.body.open).toBe(false);
    expect(r.body.slots).toEqual([]);
    expect(new Date(r.body.opensAt).getHours()).toBe(11);
  });

  it("flags a cart that cannot be cooked before closing", async () => {
    // 9:50PM Monday: open, but a 30-minute plate lands after the 10PM close.
    const { agent } = proxy(new Date(2026, 6, 27, 21, 50));
    const slow = await quote(agent, [SALMON]).expect(200);
    expect(slow.body.open).toBe(true);
    expect(slow.body.fitsBeforeClose).toBe(false);
    expect(slow.body.slots).toEqual([]);
  });
});

describe("the window the customer saw is the window on the ticket", () => {
  it("puts the quoted label on the Clover order note", async () => {
    const { agent, clover } = proxy();
    const q = await quote(agent, [SALMON]).expect(200);
    const r = await agent.post("/api/clover/orders")
      .send({ cart: [SALMON], customer: CUSTOMER, orderNumber: "FL-1" })
      .expect(200);

    expect(r.body.readyWindow.label).toBe(q.body.label);
    expect(clover.createOrder.mock.calls[0][0].orderCart.note)
      .toContain(`Pickup: ${q.body.label}`);
  });

  it("honours a scheduled slot and puts that time on the ticket instead", async () => {
    const { agent, clover } = proxy();
    const q = await quote(agent, [JERK]).expect(200);
    const slot = q.body.slots[4];

    const r = await agent.post("/api/clover/orders")
      .send({ cart: [JERK], customer: CUSTOMER, orderNumber: "FL-2", pickupAt: slot.iso })
      .expect(200);

    expect(r.body.pickupLabel).toBe(slot.label);
    expect(clover.createOrder.mock.calls[0][0].orderCart.note)
      .toContain(`Pickup: ${slot.label}`);
  });

  it("refuses a scheduled time the kitchen could not make", async () => {
    const { agent, clover } = proxy();
    const tooSoon = new Date(2026, 6, 27, 12, 5).toISOString();
    const r = await agent.post("/api/clover/orders")
      .send({ cart: [SALMON], customer: CUSTOMER, pickupAt: tooSoon })
      .expect(409);

    expect(r.body.code).toBe("BAD_PICKUP_TIME");
    expect(clover.createOrder).not.toHaveBeenCalled();
  });

  it("refuses a scheduled time after the door shuts", async () => {
    const { agent } = proxy();
    const tooLate = new Date(2026, 6, 27, 23, 0).toISOString();
    const r = await agent.post("/api/clover/orders")
      .send({ cart: [JERK], customer: CUSTOMER, pickupAt: tooLate })
      .expect(409);
    expect(r.body.code).toBe("BAD_PICKUP_TIME");
  });
});

/* ============================================================================
   ASAP is gone, and has to stay gone. It was a single number quoted for every
   dish on the menu, which is how someone ordering salmon was told fifteen
   minutes and turned up to a twenty-minute wait.
   ============================================================================ */
describe("no code path emits ASAP", () => {
  const SKIP = new Set(["node_modules", "dist", "ios", "android", ".git", "build"]);

  const walk = (dir, out = []) => {
    for (const entry of readdirSync(dir)) {
      if (SKIP.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(js|jsx|mjs)$/.test(entry)) out.push(full);
    }
    return out;
  };

  /* Shipped code only. The test files below deliberately name ASAP in order to
     assert it is gone, and would otherwise be their own offenders. */
  const files = [
    ...walk(resolve(ROOT, "src")).filter((f) => !f.includes(`${"src"}/test/`)),
    ...walk(resolve(ROOT, "server")),
    ...walk(resolve(ROOT, "scripts")),
  ];

  /* Comments explaining that ASAP was removed are the point; a string literal
     that could reach a customer, a ticket or a Clover order is not. Strip the
     commentary and look at the code. */
  const stripComments = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("has no ASAP string anywhere in the shipped code", () => {
    const offenders = [];
    for (const f of files) {
      const rel = f.slice(ROOT.length + 1);
      for (const [i, l] of stripComments(readFileSync(f, "utf8")).split("\n").entries()) {
        if (/\bASAP\b/i.test(l)) offenders.push(`${rel}:${i + 1}  ${l.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never quotes a bare fifteen minutes to a customer either", async () => {
    const { agent } = proxy();
    const r = await quote(agent, [SALMON]).expect(200);
    expect(JSON.stringify(r.body)).not.toMatch(/asap/i);
  });
});
