import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";

/* guard.js reads its config at import time, so each test re-imports with the
   env it wants. */
async function app(env = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const { createApp } = await import("../../server/app.js");
  const { __resetRateLimit } = await import("../../server/guard.js");
  __resetRateLimit();
  const clover = {
    merchant: vi.fn().mockResolvedValue({ id: "M" }),
    items: vi.fn().mockResolvedValue({ elements: [] }),
    charge: vi.fn().mockResolvedValue({ id: "CHG", status: "succeeded", amount: 100 }),
    createOrder: vi.fn().mockResolvedValue({ id: "ORD", total: 100 }),
    printOrder: vi.fn().mockResolvedValue({}),
    getOrder: vi.fn(), setStock: vi.fn(),
    findCustomerByPhone: vi.fn(), createCustomer: vi.fn(),
  };
  return { agent: request(createApp({ clover, catalog: async () => ({}) })), clover };
}

const KEYS = ["APP_KEY", "ALLOWED_ORIGINS", "MAX_CHARGE_DOLLARS"];
let saved;
beforeEach(() => { saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]])); });
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});

describe("the app key", () => {
  it("is required once one is configured", async () => {
    const { agent } = await app({ APP_KEY: "s3cret" });
    const r = await agent.get("/api/clover/inventory");
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("BAD_APP_KEY");
  });

  it("lets a request through when it matches", async () => {
    const { agent } = await app({ APP_KEY: "s3cret" });
    const r = await agent.get("/api/clover/inventory").set("x-flourish-key", "s3cret");
    expect(r.status).not.toBe(401);
  });

  it("never gates health, which the app asks before anything else", async () => {
    const { agent } = await app({ APP_KEY: "s3cret" });
    const r = await agent.get("/api/clover/health");
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it("refuses remote callers outright when no key is set, rather than being open", async () => {
    // The whole point: an unconfigured proxy on the internet must not be an
    // open payments endpoint. supertest connects over loopback, so this asserts
    // the localhost exemption applies rather than the refusal.
    const { agent } = await app({ APP_KEY: "" });
    const r = await agent.get("/api/clover/inventory");
    expect(r.status).not.toBe(401);   // loopback is allowed for `npm run dev:all`
    const { requireAppKey } = await import("../../server/guard.js");
    const res = { code: 0, body: null,
      status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    requireAppKey({ ip: "203.0.113.9", get: () => undefined, socket: {} }, res, () => {
      throw new Error("a remote caller must not be let through");
    });
    expect(res.code).toBe(503);
    expect(res.body.code).toBe("NO_APP_KEY");
  });
});

describe("the rate limit", () => {
  it("cuts off a caller hammering the register", async () => {
    const { agent } = await app({ APP_KEY: "" });
    let limited = null;
    for (let i = 0; i < 70; i++) {
      const r = await agent.get("/api/clover/health");
      if (r.status === 429) { limited = r; break; }
    }
    expect(limited, "expected a 429 within 70 requests").not.toBeNull();
    expect(limited.body.code).toBe("RATE_LIMITED");
    expect(limited.headers["retry-after"]).toBeDefined();
  });

  it("is tighter on paying than on browsing", async () => {
    const { rateLimit, payRateLimit } = await import("../../server/guard.js");
    expect(typeof payRateLimit()).toBe("function");
    expect(typeof rateLimit()).toBe("function");
  });
});

describe("the charge ceiling", () => {
  it("refuses an order far above any real one", async () => {
    const { agent, clover } = await app({ APP_KEY: "", MAX_CHARGE_DOLLARS: "500" });
    const r = await agent.post("/api/clover/pay")
      .send({ source: "tok", amountDollars: 9999 });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("AMOUNT_TOO_LARGE");
    expect(clover.charge).not.toHaveBeenCalled();
  });

  it("counts the tip toward the ceiling", async () => {
    const { agent, clover } = await app({ APP_KEY: "", MAX_CHARGE_DOLLARS: "100" });
    const r = await agent.post("/api/clover/pay")
      .send({ source: "tok", amountDollars: 95, tipDollars: 20 });
    expect(r.status).toBe(400);
    expect(clover.charge).not.toHaveBeenCalled();
  });

  it("lets an ordinary order through", async () => {
    const { agent } = await app({ APP_KEY: "", MAX_CHARGE_DOLLARS: "500" });
    const r = await agent.post("/api/clover/pay")
      .send({ source: "tok", amountDollars: 42.5, tipDollars: 5 });
    expect(r.status).toBe(200);
  });
});

describe("origins", () => {
  it("turns away a page on another domain once an allowlist is set", async () => {
    const { agent } = await app({ APP_KEY: "", ALLOWED_ORIGINS: "https://flourishbx.com" });
    const r = await agent.get("/api/clover/health").set("Origin", "https://evil.example");
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("BAD_ORIGIN");
  });

  it("allows the real site", async () => {
    const { agent } = await app({ APP_KEY: "", ALLOWED_ORIGINS: "https://flourishbx.com" });
    const r = await agent.get("/api/clover/health").set("Origin", "https://flourishbx.com");
    expect(r.status).toBe(200);
  });

  it("allows a native app, which sends no Origin at all", async () => {
    const { agent } = await app({ APP_KEY: "", ALLOWED_ORIGINS: "https://flourishbx.com" });
    expect((await agent.get("/api/clover/health")).status).toBe(200);
  });
});

describe("the honest limits of this", () => {
  it("does not pretend the app key is a secret", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const HERE = dirname(fileURLToPath(import.meta.url));
    expect(readFileSync(resolve(HERE, "../../server/guard.js"), "utf8")).toMatch(/NOT a secret/);
  });

  it("keeps the one real secret server-side", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const HERE = dirname(fileURLToPath(import.meta.url));
    const client = readFileSync(resolve(HERE, "../lib/clover.js"), "utf8");
    expect(client).not.toMatch(/CLOVER_PRIVATE_TOKEN\s*[:=]/);
  });
});
