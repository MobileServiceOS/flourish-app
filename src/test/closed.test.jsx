import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import request from "supertest";
import { createApp } from "../../server/app.js";
import { __resetRateLimit } from "../../server/guard.js";
import { addItem } from "./helpers.js";

const OPEN = new Date(2026, 6, 27, 12, 0);    // Monday noon
const SHUT = new Date(2026, 6, 27, 23, 30);   // Monday, half past eleven

/* ---------- the server, which is the enforcement that matters ---------- */
function proxy(now) {
  __resetRateLimit();
  const clover = {
    merchant: vi.fn().mockResolvedValue({ id: "M" }),
    createOrder: vi.fn().mockResolvedValue({ id: "ORD", total: 2000 }),
    printers: vi.fn().mockResolvedValue({ elements: [
      { uuid: "ZVZ9PRJ255V90", name: "Station Printer", type: "MY_LOCAL" },
    ]}),
    printEvent: vi.fn().mockResolvedValue({}),
    charge: vi.fn().mockResolvedValue({ id: "CHG", status: "succeeded", amount: 2000 }),
    items: vi.fn(), getOrder: vi.fn(), setStock: vi.fn(),
    findCustomerByPhone: vi.fn().mockResolvedValue({ elements: [] }),
    createCustomer: vi.fn().mockResolvedValue({ id: "CUST" }),
    attachCustomer: vi.fn().mockResolvedValue({}),
    sendOrderMessage: vi.fn().mockResolvedValue({}),
  };
  const agent = request(createApp({ clover, catalog: async () => ({}), now: () => now }));
  return { agent, clover };
}

const CUSTOMER = { name: "Nevaeh Reid", phone: "3478599413" };

/* Ackee & Shrimp is cooked to order — 30 minutes. Jerk Chicken comes off the
   steam table in 15. Which one is in the cart decides how late it can be
   ordered, which is the whole point of checking the READY time. */
const CART = [{ name: "Ackee & Shrimp", itemId: "AYBW9QMTC6154", qty: 1, price: 20, modifiers: [] }];
const FAST_CART = [{ name: "Jerk Chicken", itemId: "SJGN0N254K8KE", qty: 1, price: 18, modifiers: [] }];

const order = (agent, cart = CART) =>
  agent.post("/api/clover/orders").send({ cart, customer: CUSTOMER });

describe("the proxy refuses business outside opening hours", () => {
  it("will not create an order when the kitchen is shut", async () => {
    const { agent, clover } = proxy(SHUT);
    const r = await agent.post("/api/clover/orders").send({ cart: CART, customer: CUSTOMER });

    expect(r.status).toBe(409);
    expect(r.body.code).toBe("CLOSED");
    expect(r.body.error).toMatch(/closed/i);
    expect(clover.createOrder).not.toHaveBeenCalled();
  });

  it("tells the customer when it opens again", async () => {
    const { agent } = proxy(SHUT);
    const r = await agent.post("/api/clover/orders").send({ cart: CART, customer: CUSTOMER });
    expect(r.body.error).toMatch(/opens tomorrow at 11:00 AM/);
    expect(new Date(r.body.opensAt).getHours()).toBe(11);
  });

  it("will not charge a card when the kitchen is shut", async () => {
    const { agent, clover } = proxy(SHUT);
    const r = await agent.post("/api/clover/pay")
      .send({ source: "tok", amountDollars: 20 });
    expect(r.status).toBe(409);
    expect(clover.charge).not.toHaveBeenCalled();
  });

  it("takes the order during opening hours", async () => {
    const { agent, clover } = proxy(OPEN);
    const r = await order(agent);
    expect(r.status).toBe(200);
    expect(clover.createOrder).toHaveBeenCalled();
  });

  it("refuses right on closing time, not a minute after", async () => {
    const { agent } = proxy(new Date(2026, 6, 27, 22, 0));   // 10:00 PM exactly
    expect((await order(agent, FAST_CART)).status).toBe(409);
    // 9:30PM + 15 minutes is a 9:45-9:55 window, which lands before the door shuts.
    const { agent: a2 } = proxy(new Date(2026, 6, 27, 21, 30));
    expect((await order(a2, FAST_CART)).status).toBe(200);
  });
});

/* ---------- the check that matters is the READY time, not the order time ----
   The old guard only asked whether the door was open. At 9:50PM it is — but a
   30-minute plate would come out of the fryer twenty minutes after close, and
   the kitchen would be gone. */
describe("the proxy refuses food it cannot cook before closing", () => {
  it("refuses a cooked-to-order plate ordered too late, though the shop is open", async () => {
    const at = new Date(2026, 6, 27, 21, 50);   // Monday 9:50PM, closes 10PM
    const { agent, clover } = proxy(at);
    const r = await order(agent);

    expect(r.status).toBe(409);
    expect(r.body.code).toBe("TOO_LATE_TO_COOK");
    expect(r.body.prepMinutes).toBe(30);
    expect(r.body.error).toMatch(/before we close/i);
    expect(clover.createOrder).not.toHaveBeenCalled();
  });

  it("still takes a fast plate at a time it refuses a slow one", async () => {
    /* Same minute, same shop, different food. 9:30PM: jerk chicken is a
       9:45-9:55 window and fits; ackee & shrimp would be 10:00-10:10 and does
       not. This is the pair that proves the check is about the plate. */
    const at = new Date(2026, 6, 27, 21, 30);
    const { agent } = proxy(at);
    expect((await order(agent, FAST_CART)).status).toBe(200);
    const { agent: slow } = proxy(at);
    expect((await order(slow, CART)).status).toBe(409);
  });

  it("allows a cooked-to-order plate that just fits", async () => {
    // 9:15PM + 30 minutes is a 9:45-9:55 window: the last one that fits.
    const { agent, clover } = proxy(new Date(2026, 6, 27, 21, 15));
    expect((await order(agent)).status).toBe(200);
    expect(clover.createOrder).toHaveBeenCalled();
  });

  it("gives seafood the extra hour on a Friday and takes it back on Monday", async () => {
    // 2026-07-31 is a Friday: 11PM close, so 9:50PM is comfortable.
    const { agent: fri } = proxy(new Date(2026, 6, 31, 21, 50));
    expect((await order(fri)).status).toBe(200);

    // 2026-08-01 is a Saturday, also 11PM.
    const { agent: sat } = proxy(new Date(2026, 7, 1, 22, 20));
    expect((await order(sat)).status).toBe(200);

    // Sunday is back to 10PM.
    const { agent: sun } = proxy(new Date(2026, 7, 2, 21, 50));
    expect((await order(sun)).status).toBe(409);
  });

  it("says how long the food needs and when the kitchen shuts", async () => {
    const { agent } = proxy(new Date(2026, 6, 27, 21, 50));
    const r = await order(agent);
    expect(r.body.error).toMatch(/30 minutes/);
    expect(new Date(r.body.closesAt).getHours()).toBe(22);
    expect(new Date(r.body.readyBy).getTime()).toBeGreaterThan(new Date(r.body.closesAt).getTime());
  });
});

/* ---------- and the app, so nobody gets that far ---------- */
async function renderApp(when) {
  vi.setSystemTime(when);
  vi.resetModules();
  const { default: App } = await import("../App.jsx");
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<App />);
  await screen.findByRole("button", { name: /staff/i });
  return { user };
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe("the cart when the store is shut", () => {
  it("says so, and will not go to checkout", async () => {
    const { user } = await renderApp(SHUT);
    await addItem(user);
    await user.click(await screen.findByRole("button", { name: /cart, 1 item/i }));

    expect(await screen.findByText(/We're closed right now/)).toBeInTheDocument();
    expect(screen.getByText(/opens tomorrow at 11:00 AM/)).toBeInTheDocument();

    const cta = screen.getByRole("button", { name: /Closed — order when we open/ });
    expect(cta).toBeDisabled();
  });

  it("keeps the cart, so nothing is lost until they open", async () => {
    const { user } = await renderApp(SHUT);
    await addItem(user);
    await user.click(await screen.findByRole("button", { name: /cart, 1 item/i }));
    expect(screen.getByRole("button", { name: /cart, 1 item/i })).toBeInTheDocument();
    expect(screen.getByText(/keeps everything in it/)).toBeInTheDocument();
  });

  it("goes to checkout normally during opening hours", async () => {
    const { user } = await renderApp(OPEN);
    await addItem(user);
    await user.click(await screen.findByRole("button", { name: /cart, 1 item/i }));

    const cta = await screen.findByRole("button", { name: /go to checkout/i });
    expect(cta).toBeEnabled();
    await user.click(cta);
    expect(await screen.findByText("Pickup details")).toBeInTheDocument();
  });
});
