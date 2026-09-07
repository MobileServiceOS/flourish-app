import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import {
  api, PRINT_EVENT_PATH, printEventUrl, printEventBody, printOrderTicket,
  probeMessaging, sendCustomerMessage, messagingState,
  __resetPrinters, __resetMessaging, CloverError,
} from "../../server/clover.js";
import { API_BASE, MERCHANT_ID, CONFIGURED } from "../../server/env.js";
import { createApp } from "../../server/app.js";
import { __resetRateLimit } from "../../server/guard.js";

/* ============================================================================
   THE PRINT URL

   Three rounds of "the printer is fixed" went by while every ticket 405'd,
   because print_event is MERCHANT-scoped and the server was posting to an
   ORDER-scoped path:

     works:  POST /v3/merchants/{mId}/print_event
     was:    POST /v3/merchants/{mId}/orders/{orderId}/print_event

   Clover answers an unrouted path with `405 POST not allowed` — the identical
   response a made-up endpoint gets — so the failure said nothing about the
   path, and the path was the whole bug. The order is named by `orderRef` in
   the body; it never belonged in the URL.

   These tests pin the request itself, not the intention behind it.
   ============================================================================ */

const EXPECTED_URL = `${API_BASE}/v3/merchants/${MERCHANT_ID}/print_event`;

beforeEach(() => { __resetPrinters(); __resetMessaging(); __resetRateLimit(); vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("the URL a ticket is printed to", () => {
  it("is exactly {API_BASE}/v3/merchants/{mId}/print_event", () => {
    expect(printEventUrl()).toBe(EXPECTED_URL);
  });

  it("is merchant-scoped, carrying no order id in the path", () => {
    // The regression, stated directly.
    expect(PRINT_EVENT_PATH).toBe(`/v3/merchants/${MERCHANT_ID}/print_event`);
    expect(PRINT_EVENT_PATH).not.toMatch(/\/orders\//);
    expect(printEventUrl()).not.toMatch(/\/orders\//);
  });

  it("is not pluralised", () => {
    expect(printEventUrl()).toMatch(/\/print_event$/);
    expect(printEventUrl()).not.toMatch(/print_events/);
  });

  it("has no doubled slash anywhere after the scheme", () => {
    // A trailing slash on API_BASE or the merchant id would build
    // .../merchants/ABC//print_event, which is a different, unrouted path.
    expect(printEventUrl().replace(/^https?:\/\//, "")).not.toMatch(/\/\//);
    expect(printEventUrl()).not.toMatch(/\/\/v3/);
  });

  it("names the order in the body, with the printer alongside it", () => {
    expect(printEventBody("ORD-1", "ZVZ9PRJ255V90")).toEqual({
      orderRef: { id: "ORD-1" },
      printer: { id: "ZVZ9PRJ255V90" },
    });
  });
});

/* Building the string correctly is not the same as sending it. This asserts on
   what actually reaches fetch — method, URL, headers and body — so a wrapper
   that rewrote the method or re-joined the path could not slip through. */
describe("the request that actually goes on the wire", () => {
  const capture = () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: "PE-1" }) };
    }));
    return calls;
  };

  it.skipIf(!CONFIGURED)("POSTs the exact URL the working curl uses", async () => {
    const calls = capture();
    await api.printEvent("ORD-1", "ZVZ9PRJ255V90");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(EXPECTED_URL);
  });

  it.skipIf(!CONFIGURED)("uses POST, not whatever a wrapper felt like", async () => {
    const calls = capture();
    await api.printEvent("ORD-1", "ZVZ9PRJ255V90");
    expect(calls[0].init.method).toBe("POST");
  });

  it.skipIf(!CONFIGURED)("sends JSON carrying orderRef.id and printer.id", async () => {
    const calls = capture();
    await api.printEvent("ORD-77", "PRINTER-9");

    expect(calls[0].init.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(calls[0].init.body);
    expect(body).toEqual({ orderRef: { id: "ORD-77" }, printer: { id: "PRINTER-9" } });
    expect(body.orderRef.id).toBe("ORD-77");
    expect(body.printer.id).toBe("PRINTER-9");
  });

  it.skipIf(!CONFIGURED)("carries the bearer token in the header, never in the URL", async () => {
    const calls = capture();
    await api.printEvent("ORD-1", "P1");
    expect(calls[0].init.headers.Authorization).toMatch(/^Bearer /);
    expect(calls[0].url).not.toMatch(/token|Bearer/i);
  });
});

describe("a print failure says which URL failed", () => {
  const client = (over = {}) => ({
    printers: vi.fn().mockResolvedValue({ elements: [{ uuid: "P1", type: "MY_LOCAL" }] }),
    printEvent: vi.fn().mockResolvedValue({}),
    ...over,
  });
  const instant = { sleep: async () => {} };

  it("reports the status and the resolved URL together", async () => {
    /* "405 POST not allowed" on its own is what made this take three rounds:
       the status says the path is not routed, while omitting the path. */
    const c = client({
      printEvent: vi.fn().mockRejectedValue(
        new CloverError(405, "405 POST not allowed.", {}, EXPECTED_URL)
      ),
    });
    const r = await printOrderTicket("ORD-1", { client: c, ...instant });

    expect(r.printed).toBe(false);
    expect(r.status).toBe(405);
    expect(r.url).toBe(EXPECTED_URL);
  });

  it("still reports a URL when there is no printer to send to", async () => {
    const errs = vi.spyOn(console, "error").mockImplementation(() => {});
    const c = client({ printers: vi.fn().mockResolvedValue({ elements: [] }) });
    const r = await printOrderTicket("ORD-1", { client: c, ...instant });
    expect(r.url).toBe(EXPECTED_URL);
    errs.mockRestore();
  });

  it("logs the URL and the body before firing, so a wrong one is visible", async () => {
    const logs = [];
    const log = vi.spyOn(console, "log").mockImplementation((...a) => logs.push(a.join(" ")));
    await printOrderTicket("ORD-42", { client: client(), ...instant });
    log.mockRestore();

    const line = logs.find((l) => l.includes("print: POST"));
    expect(line).toBeTruthy();
    expect(line).toContain(EXPECTED_URL);
    expect(line).toContain('"orderRef":{"id":"ORD-42"}');
    expect(line).not.toMatch(/Bearer/);
  });
});

/* ============================================================================
   MESSAGING IS A DIFFERENT FAILURE THAT WORE THE SAME CODE

   Clover's order messaging is not on this merchant's plan, and every attempt
   answered 405 — the same status the print bug produced, for an unrelated
   reason. Sharing a code path is how one got mistaken for the other, and
   warning per order is how the print failure got buried.
   ============================================================================ */
describe("customer messaging is detected once, then left alone", () => {
  const unavailable = () => ({
    sendOrderMessage: vi.fn().mockRejectedValue(new CloverError(405, "405 POST not allowed.", {})),
  });

  it("reads a 405 on the probe as the feature being absent", async () => {
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await probeMessaging({ client: unavailable() })).toBe("unavailable");
    logs.mockRestore();
  });

  it("says so exactly once, not once per order", async () => {
    const logs = [];
    const log = vi.spyOn(console, "log").mockImplementation((...a) => logs.push(a.join(" ")));
    const c = unavailable();

    await probeMessaging({ client: c });
    for (let i = 0; i < 5; i++) await sendCustomerMessage(`ORD-${i}`, "hi", { client: c });
    log.mockRestore();

    expect(logs.filter((l) => /Messaging/i.test(l))).toHaveLength(1);
  });

  it("stops attempting altogether once it knows", async () => {
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    const c = unavailable();
    await probeMessaging({ client: c });
    const afterProbe = c.sendOrderMessage.mock.calls.length;

    for (let i = 0; i < 5; i++) await sendCustomerMessage(`ORD-${i}`, "hi", { client: c });
    // Not one further call: the whole point is to stop asking.
    expect(c.sendOrderMessage.mock.calls.length).toBe(afterProbe);
    logs.mockRestore();
  });

  it("treats a 404 as the feature being present and the order being wrong", async () => {
    const c = { sendOrderMessage: vi.fn().mockRejectedValue(new CloverError(404, "No order", {})) };
    expect(await probeMessaging({ client: c })).toBe("available");
  });

  it("keeps sending when the merchant does have messaging", async () => {
    const c = { sendOrderMessage: vi.fn().mockResolvedValue({ id: "MSG-1" }) };
    await probeMessaging({ client: c });
    expect(await sendCustomerMessage("ORD-1", "hi", { client: c })).toBe(true);
    expect(messagingState()).toBe("available");
  });
});

/* ---------- through the proxy ---------- */
const CART = [{ name: "Jerk Chicken", itemId: "SJGN0N254K8KE", qty: 1, price: 18, modifiers: [] }];
const CUSTOMER = { name: "Nevaeh Reid", phone: "3478599413" };
const OPEN = new Date(2026, 6, 27, 12, 0);

function proxy(over = {}, printTicket) {
  const clover = {
    merchant: vi.fn().mockResolvedValue({ id: "M" }),
    createOrder: vi.fn().mockResolvedValue({ id: "CLV-9", total: 2000 }),
    getOrder: vi.fn().mockResolvedValue({ id: "CLV-9", state: "open", total: 2000 }),
    printers: vi.fn().mockResolvedValue({ elements: [{ uuid: "P1", name: "Station", type: "MY_LOCAL" }] }),
    printEvent: vi.fn().mockResolvedValue({}),
    findCustomerByPhone: vi.fn().mockResolvedValue({ elements: [] }),
    createCustomer: vi.fn().mockResolvedValue({ id: "C1" }),
    attachCustomer: vi.fn().mockResolvedValue({}),
    sendOrderMessage: vi.fn().mockRejectedValue(new CloverError(405, "405 POST not allowed.", {})),
    loyaltyProgram: vi.fn().mockRejectedValue(new CloverError(405, "405", {})),
    loyaltyTiers: vi.fn().mockRejectedValue(new CloverError(405, "405", {})),
    items: vi.fn(), setStock: vi.fn(), charge: vi.fn(), fulfillOrder: vi.fn(),
    ...over,
  };
  return {
    clover,
    agent: request(createApp({
      clover, catalog: async () => ({}), now: () => OPEN,
      printTicket: printTicket ?? ((id) => printOrderTicket(id, { client: clover, sleep: async () => {} })),
    })),
  };
}

const place = (agent) =>
  agent.post("/api/clover/orders").send({ cart: CART, customer: CUSTOMER, orderNumber: "FL-1" });

describe("ordering, end to end", () => {
  it("prints to the merchant-scoped URL and reports success", async () => {
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    const { agent, clover } = proxy();
    const r = await place(agent).expect(200);

    expect(clover.printEvent).toHaveBeenCalledWith("CLV-9", "P1");
    expect(r.body.printed).toBe(true);
    logs.mockRestore();
  });

  it("does not warn about messaging on every order", async () => {
    const warns = [];
    const warn = vi.spyOn(console, "warn").mockImplementation((...a) => warns.push(a.join(" ")));
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});

    const { agent } = proxy();
    await place(agent).expect(200);
    await place(agent).expect(200);
    await place(agent).expect(200);
    warn.mockRestore(); logs.mockRestore();

    expect(warns.filter((l) => /message/i.test(l))).toHaveLength(0);
  });

  it("puts the failing URL in the log when a print fails", async () => {
    const warns = [];
    const warn = vi.spyOn(console, "warn").mockImplementation((...a) => warns.push(a.join(" ")));
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});

    const { agent } = proxy({
      printEvent: vi.fn().mockRejectedValue(
        new CloverError(405, "405 POST not allowed.", {}, EXPECTED_URL)
      ),
    });
    await place(agent).expect(200);
    warn.mockRestore(); logs.mockRestore();

    const line = warns.find((l) => /not printed/.test(l));
    expect(line).toContain("405");
    expect(line).toContain(EXPECTED_URL);
  });
});

describe("POST /print-test always answers in JSON", () => {
  const asJson = (r) => {
    expect(r.headers["content-type"]).toMatch(/application\/json/);
    expect(r.body).toBeTypeOf("object");
    expect(r.body).not.toBeNull();
    return r.body;
  };

  it("answers with JSON when there is no order to reprint", async () => {
    // This returned an empty body, so curl had nothing to parse — a diagnostic
    // tool that itself needed diagnosing.
    const { agent } = proxy();
    const body = asJson(await agent.post("/api/clover/print-test").send({}).expect(404));
    expect(body.code).toBe("NO_RECENT_ORDER");
    expect(body.ok).toBe(false);
    expect(body.url).toBe(EXPECTED_URL);
  });

  it("answers with JSON, and the URL, when the print fails", async () => {
    const { agent } = proxy({}, async () => ({
      printed: false, printer: null, printError: "405 POST not allowed.",
      status: 405, url: EXPECTED_URL,
    }));
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    const warns = vi.spyOn(console, "warn").mockImplementation(() => {});
    await place(agent).expect(200);
    logs.mockRestore(); warns.mockRestore();

    const body = asJson(await agent.post("/api/clover/print-test").send({}).expect(502));
    expect(body.ok).toBe(false);
    expect(body.status).toBe(405);
    expect(body.url).toBe(EXPECTED_URL);
    expect(body.error).toContain("405");
  });

  it("answers with JSON and the printer when it works", async () => {
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    const { agent } = proxy();
    await place(agent).expect(200);

    const body = asJson(await agent.post("/api/clover/print-test").send({}).expect(200));
    expect(body.ok).toBe(true);
    expect(body.printed).toBe(true);
    expect(body.orderId).toBe("CLV-9");
    expect(body.orderNumber).toBe("FL-1");
    expect(body.url).toBe(EXPECTED_URL);
    logs.mockRestore();
  });

  it("answers with JSON even if the printer path throws outright", async () => {
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    const warns = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { agent } = proxy({}, async () => { throw new Error("something unforeseen"); });
    await place(agent).expect(200);
    logs.mockRestore(); warns.mockRestore();

    const body = asJson(await agent.post("/api/clover/print-test").send({}).expect(500));
    expect(body.ok).toBe(false);
    expect(body.url).toBe(EXPECTED_URL);
  });
});

describe("health shows where tickets go", () => {
  it("reports the print URL and the messaging state", async () => {
    const { agent } = proxy();
    const r = await agent.get("/api/clover/health").expect(200);
    expect(r.body.printEventUrl).toBe(EXPECTED_URL);
    expect(["unknown", "available", "unavailable"]).toContain(r.body.messaging);
  });
});
