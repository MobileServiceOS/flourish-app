import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp, maskPhone } from "../../server/app.js";
import { __resetRateLimit } from "../../server/guard.js";
import { __resetPrinters, __scrub, CloverError } from "../../server/clover.js";

/* Two things must never reach a log file:

   - the Clover private token, which is the one real secret in this codebase
   - a customer's phone number, which prints on tickets and would otherwise sit
     in plaintext in whatever log aggregator the host happens to use

   The failure path is the dangerous one, because that is where things get
   logged at all — so these tests make the failure paths fire. */

const PHONE = "3478599413";
const CUSTOMER = { name: "Nevaeh Reid", phone: PHONE };
const CART = [{ name: "Jerk Chicken", itemId: "SJGN0N254K8KE", qty: 1, price: 18, modifiers: [] }];
const OPEN = new Date(2026, 6, 27, 12, 0);

function proxy(over = {}) {
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

beforeEach(() => { __resetRateLimit(); __resetPrinters(); vi.clearAllMocks(); });

describe("masking a phone number", () => {
  it("keeps only the last two digits", () => {
    expect(maskPhone(PHONE)).toBe("(***) ***-**13");
    expect(maskPhone("(347) 859-9413")).toBe("(***) ***-**13");
  });

  it("does not contain the number it was given", () => {
    expect(maskPhone(PHONE)).not.toContain("3478599");
    expect(maskPhone(PHONE)).not.toContain("859");
  });

  it("says so plainly when there is no number at all", () => {
    expect(maskPhone(undefined)).toBe("(none)");
    expect(maskPhone("")).toBe("(none)");
  });
});

describe("nothing sensitive reaches the console", () => {
  const capture = () => {
    const lines = [];
    const push = (...a) => lines.push(a.map(String).join(" "));
    const warn = vi.spyOn(console, "warn").mockImplementation(push);
    const error = vi.spyOn(console, "error").mockImplementation(push);
    const log = vi.spyOn(console, "log").mockImplementation(push);
    return {
      lines,
      restore: () => { warn.mockRestore(); error.mockRestore(); log.mockRestore(); },
    };
  };

  it("masks the phone number when attaching a customer fails", async () => {
    const cap = capture();
    const { agent } = proxy({
      attachCustomer: vi.fn().mockRejectedValue(new Error("409 conflict")),
    });
    await agent.post("/api/clover/orders")
      .send({ cart: CART, customer: CUSTOMER, orderNumber: "FL-1" })
      .expect(200);
    cap.restore();

    const all = cap.lines.join("\n");
    expect(all).not.toContain(PHONE);
    expect(all).toContain("(***) ***-**13");
  });

  it("logs no phone number when messaging fails either", async () => {
    const cap = capture();
    const { agent } = proxy({
      sendOrderMessage: vi.fn().mockRejectedValue(new Error("405 Method Not Allowed")),
    });
    await agent.post("/api/clover/orders")
      .send({ cart: CART, customer: CUSTOMER, orderNumber: "FL-1" })
      .expect(200);
    cap.restore();

    expect(cap.lines.join("\n")).not.toContain(PHONE);
  });

  it("scrubs anything token-shaped out of a Clover message", () => {
    // Clover echoes request context back in some error bodies.
    const withBearer = "GET failed: Authorization: Bearer abc123.def-456_ghi";
    expect(__scrub(withBearer)).toContain("Bearer «redacted»");
    expect(__scrub(withBearer)).not.toContain("abc123");
  });

  it("never puts a token in a print error handed back to the client", async () => {
    const app2 = request(createApp({
      clover: proxy().clover,
      catalog: async () => ({}),
      now: () => OPEN,
      // A print error is shown to staff, so the Clover message is useful — but
      // it goes through scrub() before it can leave the server.
      printTicket: async () => ({
        printed: false, printer: null,
        printError: __scrub("Bearer sk_live_should_never_appear"),
      }),
    }));
    const r = await app2.post("/api/clover/orders")
      .send({ cart: CART, customer: CUSTOMER, orderNumber: "FL-1" })
      .expect(200);

    expect(r.body.printed).toBe(false);
    expect(r.body.printError).not.toContain("sk_live_should_never_appear");
    expect(r.body.printError).toContain("«redacted»");
  });

  it("keeps a Clover auth failure from reaching the customer verbatim", async () => {
    const { agent } = proxy({
      createOrder: vi.fn().mockRejectedValue(
        new CloverError(401, "401 Unauthorized: Bearer leaked-token", {})
      ),
    });
    const r = await agent.post("/api/clover/orders")
      .send({ cart: CART, customer: CUSTOMER })
      .expect(502);

    expect(JSON.stringify(r.body)).not.toContain("leaked-token");
    expect(r.body.code).toBe("CREDENTIALS");
  });
});
