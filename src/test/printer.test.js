import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import {
  selectPrinter, resolvePrinter, printOrderTicket, describePrinter,
  __resetPrinters, CloverError,
} from "../../server/clover.js";
import { createApp } from "../../server/app.js";
import { __resetRateLimit } from "../../server/guard.js";

/* ============================================================================
   THE BUG

   Clover reported exactly one printer for this merchant: uuid ZVZ9PRJ255V90,
   type "MY_LOCAL" — the Station's built-in roll. A print_event fired by hand
   against that uuid printed fine. The proxy's own print never did, because it
   POSTed a print_event naming NO printer and Clover routed it nowhere.

   The fix is the final fallback in selectPrinter: if the merchant has any
   printer at all, one of them is chosen. Preferring an order or kitchen printer
   is a nicety. Never returning null from a non-empty list is the actual fix, so
   these tests lean hardest on that.
   ============================================================================ */

const LOCAL = { uuid: "ZVZ9PRJ255V90", name: "Station Printer", type: "MY_LOCAL" };
const ORDER_P = { uuid: "ORDER-1", name: "Kitchen Order", type: "order" };
const KITCHEN = { uuid: "KIT-1", name: "Line", type: "kitchen" };
const FISCAL = { uuid: "FIS-1", name: "Fiscal", type: "fiscal" };
const RECEIPT = { uuid: "REC-1", name: "Front", type: "receipt" };

beforeEach(() => {
  vi.clearAllMocks();
  __resetPrinters();
  __resetRateLimit();
});

describe("the app key is read per request, not per import", () => {
  /* This suite used to fail roughly one run in nine with a 401: guard.js
     captured APP_KEY at import time, so a worker that imported it while
     guard.test.js had a key set inherited that key and rejected these
     requests. The key in force must be the one set right now. */
  it("does not inherit a key another test file happened to set", async () => {
    const { appKey } = await import("../../server/guard.js");
    const saved = process.env.APP_KEY;
    try {
      process.env.APP_KEY = "set-by-someone-else";
      expect(appKey()).toBe("set-by-someone-else");
      delete process.env.APP_KEY;
      expect(appKey()).toBe("");
    } finally {
      if (saved === undefined) delete process.env.APP_KEY;
      else process.env.APP_KEY = saved;
    }
  });
});

describe("choosing a printer", () => {
  it("picks MY_LOCAL when it is the only printer — the live bug", () => {
    expect(selectPrinter([LOCAL])?.uuid).toBe("ZVZ9PRJ255V90");
  });

  it("never returns null while the merchant has any printer at all", () => {
    const selectPrinter_ = (list) => selectPrinter(list, "");
    // The important property, stated directly. A ticket on the wrong roll is a
    // nuisance; a ticket on no roll is an order the kitchen never sees.
    const lists = [
      [LOCAL], [RECEIPT], [FISCAL], [KITCHEN], [ORDER_P],
      [{ uuid: "X-1", name: "Mystery", type: "SOMETHING_NEW" }],
      [{ uuid: "X-2", name: "No type at all" }],
      [RECEIPT, LOCAL], [LOCAL, ORDER_P, KITCHEN],
    ];
    for (const list of lists) expect(selectPrinter_(list)).not.toBeNull();
  });

  it("picks a printer whose type it has never heard of", () => {
    const odd = { uuid: "X-9", name: "Whatever Clover invents next", type: "HOLOGRAM" };
    expect(selectPrinter([odd], "")?.uuid).toBe("X-9");
  });

  it("picks one with no type field at all", () => {
    expect(selectPrinter([{ uuid: "X-8", name: "Untyped" }], "")?.uuid).toBe("X-8");
  });

  it("prefers an order printer, then kitchen, then fiscal, then receipt, then MY_LOCAL", () => {
    /* Explicitly unpinned. .env.local pins this merchant's Station, and a pin
       beats every preference by design — which the next test is about. */
    const pick = (list) => selectPrinter(list, "");
    expect(pick([LOCAL, RECEIPT, FISCAL, KITCHEN, ORDER_P]).type).toBe("order");
    expect(pick([LOCAL, RECEIPT, FISCAL, KITCHEN]).type).toBe("kitchen");
    expect(pick([LOCAL, RECEIPT, FISCAL]).type).toBe("fiscal");
    expect(pick([LOCAL, RECEIPT]).type).toBe("receipt");
    expect(pick([LOCAL]).type).toBe("MY_LOCAL");
  });

  it("lets an explicit CLOVER_PRINTER_UUID win over every preference", () => {
    const chosen = selectPrinter([ORDER_P, KITCHEN, LOCAL], "ZVZ9PRJ255V90");
    expect(chosen.uuid).toBe("ZVZ9PRJ255V90");
  });

  it("falls back rather than refusing when the pinned uuid is not there", () => {
    // A stale uuid in .env.local must not stop the kitchen printing.
    const chosen = selectPrinter([ORDER_P, LOCAL], "UUID-THAT-WENT-AWAY");
    expect(chosen.uuid).toBe("ORDER-1");
  });

  it("returns null only when the list is genuinely empty", () => {
    expect(selectPrinter([], "")).toBeNull();
    expect(selectPrinter(null, "")).toBeNull();
    expect(selectPrinter([null, undefined], "")).toBeNull();
  });

  it("accepts `id` where Clover gives no `uuid`", () => {
    expect(selectPrinter([{ id: "ID-ONLY", type: "order" }], "")?.id).toBe("ID-ONLY");
    expect(describePrinter({ id: "ID-ONLY", type: "order" }).uuid).toBe("ID-ONLY");
  });
});

describe("reading the printer list", () => {
  const client = (printers = [LOCAL]) => ({
    printers: vi.fn().mockResolvedValue({ elements: printers }),
    printEvent: vi.fn().mockResolvedValue({ id: "PRINT-1" }),
  });

  it("caches the list for ten minutes rather than asking on every order", async () => {
    const c = client();
    await resolvePrinter({ client: c });
    await resolvePrinter({ client: c });
    await resolvePrinter({ client: c });
    expect(c.printers).toHaveBeenCalledTimes(1);
  });

  it("asks again once the cache is stale", async () => {
    const c = client();
    await resolvePrinter({ client: c, now: 0 });
    await resolvePrinter({ client: c, now: 11 * 60_000 });
    expect(c.printers).toHaveBeenCalledTimes(2);
  });

  it("handles an empty list without throwing, and chooses nothing", async () => {
    const c = client([]);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { printer, printers } = await resolvePrinter({ client: c });
    expect(printer).toBeNull();
    expect(printers).toEqual([]);
    // A merchant with no printer is a real operational problem, said loudly.
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe("printing a ticket", () => {
  const instant = { sleep: async () => {} };

  const client = (over = {}) => ({
    printers: vi.fn().mockResolvedValue({ elements: [LOCAL] }),
    printEvent: vi.fn().mockResolvedValue({ id: "PRINT-1" }),
    ...over,
  });

  it("names the chosen printer on the print event", async () => {
    const c = client();
    const r = await printOrderTicket("ORD-1", { client: c, ...instant });
    expect(c.printEvent).toHaveBeenCalledWith("ORD-1", "ZVZ9PRJ255V90");
    expect(r.printed).toBe(true);
    expect(r.printer).toEqual({ uuid: "ZVZ9PRJ255V90", name: "Station Printer", type: "MY_LOCAL" });
  });

  it("retries once when the first attempt fails, and reports success", async () => {
    const printEvent = vi.fn()
      .mockRejectedValueOnce(new CloverError(500, "Printer busy", {}))
      .mockResolvedValueOnce({ id: "PRINT-2" });
    const c = client({ printEvent });
    const r = await printOrderTicket("ORD-1", { client: c, ...instant });

    expect(printEvent).toHaveBeenCalledTimes(2);
    expect(r.printed).toBe(true);
  });

  it("waits before retrying, rather than hammering a busy station", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const c = client({
      printEvent: vi.fn().mockRejectedValue(new CloverError(500, "Printer busy", {})),
    });
    await printOrderTicket("ORD-1", { client: c, sleep });
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("gives up after the retry and says why", async () => {
    const c = client({
      printEvent: vi.fn().mockRejectedValue(new CloverError(500, "Printer offline", {})),
    });
    const r = await printOrderTicket("ORD-1", { client: c, ...instant });

    expect(c.printEvent).toHaveBeenCalledTimes(2);
    expect(r.printed).toBe(false);
    expect(r.printError).toBeTruthy();
  });

  it("re-reads the printer list on a 404 and prints to whatever replaced it", async () => {
    /* A 404 means this printer is gone — unpaired, swapped, replaced. Waiting
       two seconds and asking the same dead uuid again would achieve nothing. */
    const printEvent = vi.fn()
      .mockRejectedValueOnce(new CloverError(404, "No such printer", {}))
      .mockResolvedValueOnce({ id: "PRINT-3" });
    const printers = vi.fn()
      .mockResolvedValueOnce({ elements: [LOCAL] })
      .mockResolvedValueOnce({ elements: [ORDER_P] });
    const c = { printers, printEvent };

    const r = await printOrderTicket("ORD-1", { client: c, ...instant });

    expect(printers).toHaveBeenCalledTimes(2);
    expect(printEvent).toHaveBeenNthCalledWith(1, "ORD-1", "ZVZ9PRJ255V90");
    expect(printEvent).toHaveBeenNthCalledWith(2, "ORD-1", "ORDER-1");
    expect(r.printed).toBe(true);
  });

  it("does not sleep-and-retry on a 404 — the printer is gone, not busy", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const c = {
      printers: vi.fn().mockResolvedValue({ elements: [LOCAL] }),
      printEvent: vi.fn()
        .mockRejectedValueOnce(new CloverError(404, "No such printer", {}))
        .mockResolvedValueOnce({ id: "PRINT-4" }),
    };
    await printOrderTicket("ORD-1", { client: c, sleep });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("reports the truth when the merchant has no printer", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const c = client({ printers: vi.fn().mockResolvedValue({ elements: [] }) });
    const r = await printOrderTicket("ORD-1", { client: c, ...instant });

    expect(r.printed).toBe(false);
    expect(r.printError).toMatch(/no printer/i);
    expect(c.printEvent).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("never throws, whatever Clover does", async () => {
    const c = { printers: vi.fn().mockRejectedValue(new Error("network gone")) };
    await expect(printOrderTicket("ORD-1", { client: c, ...instant })).resolves.toMatchObject({
      printed: false,
    });
  });
});

/* ---------- through the proxy ---------- */
const CATALOG = { "45KGD3ZDMT2ZY": { Medium: { id: "MOD-MED", price: 20 } } };
const CART = [{
  name: "Jerk Chicken", itemId: "SJGN0N254K8KE", qty: 1, price: 18,
  modifiers: [{ gid: "45KGD3ZDMT2ZY", name: "Medium", price: 20 }],
}];
const CUSTOMER = { name: "Nevaeh Reid", phone: "3478599413" };
const OPEN = new Date(2026, 6, 27, 12, 0);

function proxy(over = {}) {
  const clover = {
    merchant: vi.fn().mockResolvedValue({ id: "M" }),
    createOrder: vi.fn().mockResolvedValue({ id: "CLV-9", total: 2000 }),
    printers: vi.fn().mockResolvedValue({ elements: [LOCAL] }),
    printEvent: vi.fn().mockResolvedValue({ id: "PRINT-1" }),
    findCustomerByPhone: vi.fn().mockResolvedValue({ elements: [] }),
    createCustomer: vi.fn().mockResolvedValue({ id: "CUST-9" }),
    attachCustomer: vi.fn().mockResolvedValue({}),
    sendOrderMessage: vi.fn().mockResolvedValue({}),
    items: vi.fn(), getOrder: vi.fn(), setStock: vi.fn(), charge: vi.fn(),
    fulfillOrder: vi.fn(),
    ...over,
  };
  return {
    clover,
    agent: request(createApp({
      clover, catalog: async () => CATALOG, now: () => OPEN,
      printTicket: (id) => printOrderTicket(id, { client: clover, sleep: async () => {} }),
    })),
  };
}

const place = (agent) =>
  agent.post("/api/clover/orders").send({ cart: CART, customer: CUSTOMER, orderNumber: "FL-1" });

describe("the proxy's printing", () => {
  it("prints to the merchant's only printer and reports that it did", async () => {
    const { agent, clover } = proxy();
    const r = await place(agent).expect(200);

    expect(clover.printEvent).toHaveBeenCalledWith("CLV-9", "ZVZ9PRJ255V90");
    expect(r.body.printed).toBe(true);
    expect(r.body.printError).toBeNull();
  });

  it("does not lose the order when the printer refuses", async () => {
    /* The order is on the register either way and staff can read it off the
       screen. Losing a sale to a jammed roll of paper would be the worse bug. */
    const { agent, clover } = proxy({
      printEvent: vi.fn().mockRejectedValue(new CloverError(500, "Printer offline", {})),
    });
    const r = await place(agent).expect(200);

    expect(r.body.success).toBe(true);
    expect(r.body.orderId).toBe("CLV-9");
    expect(r.body.printed).toBe(false);
    expect(r.body.printError).toBeTruthy();
    expect(clover.createOrder).toHaveBeenCalled();
  });

  it("does not lose the order when the merchant has no printer at all", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { agent } = proxy({ printers: vi.fn().mockResolvedValue({ elements: [] }) });
    const r = await place(agent).expect(200);
    expect(r.body.success).toBe(true);
    expect(r.body.printed).toBe(false);
    errors.mockRestore();
  });
});

describe("seeing what the server chose", () => {
  it("lists every printer and which one gets the ticket", async () => {
    // Neither of these is the uuid pinned in .env.local, so the type order
    // decides: an order printer beats a receipt printer.
    const { agent } = proxy({
      printers: vi.fn().mockResolvedValue({ elements: [RECEIPT, ORDER_P] }),
    });
    const r = await agent.get("/api/clover/printers").expect(200);

    expect(r.body.chosen).toEqual({ uuid: "ORDER-1", name: "Kitchen Order", type: "order" });
    expect(r.body.printers).toHaveLength(2);
  });

  it("reports the printer on the health check", async () => {
    const { agent } = proxy();
    const r = await agent.get("/api/clover/health").expect(200);

    expect(r.body.printerConfigured).toBe(true);
    expect(r.body.printerName).toBe("Station Printer");
    expect(r.body.printerType).toBe("MY_LOCAL");
  });

  it("says printing is not configured when there are no printers", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { agent } = proxy({ printers: vi.fn().mockResolvedValue({ elements: [] }) });
    const r = await agent.get("/api/clover/health").expect(200);
    expect(r.body.printerConfigured).toBe(false);
    expect(r.body.printerName).toBeNull();
    errors.mockRestore();
  });
});

describe("the print test", () => {
  it("reprints the most recent app order", async () => {
    const { agent, clover } = proxy();
    await place(agent).expect(200);
    clover.printEvent.mockClear();

    const r = await agent.post("/api/clover/print-test").send({}).expect(200);
    expect(clover.printEvent).toHaveBeenCalledWith("CLV-9", "ZVZ9PRJ255V90");
    expect(r.body.printed).toBe(true);
    expect(r.body.orderId).toBe("CLV-9");
    expect(r.body.orderNumber).toBe("FL-1");
  });

  it("says so plainly when no order has been placed yet", async () => {
    const { agent } = proxy();
    const r = await agent.post("/api/clover/print-test").send({}).expect(404);
    expect(r.body.code).toBe("NO_RECENT_ORDER");
  });
});
