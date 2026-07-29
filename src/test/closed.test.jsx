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
    printOrder: vi.fn().mockResolvedValue({}),
    charge: vi.fn().mockResolvedValue({ id: "CHG", status: "succeeded", amount: 2000 }),
    items: vi.fn(), getOrder: vi.fn(), setStock: vi.fn(),
    findCustomerByPhone: vi.fn(), createCustomer: vi.fn(),
  };
  const agent = request(createApp({ clover, catalog: async () => ({}), now: () => now }));
  return { agent, clover };
}

const CART = [{ name: "Ackee & Shrimp", itemId: "AYBW9QMTC6154", qty: 1, price: 20, modifiers: [] }];

describe("the proxy refuses business outside opening hours", () => {
  it("will not create an order when the kitchen is shut", async () => {
    const { agent, clover } = proxy(SHUT);
    const r = await agent.post("/api/clover/orders").send({ cart: CART });

    expect(r.status).toBe(409);
    expect(r.body.code).toBe("CLOSED");
    expect(r.body.error).toMatch(/closed/i);
    expect(clover.createOrder).not.toHaveBeenCalled();
  });

  it("tells the customer when it opens again", async () => {
    const { agent } = proxy(SHUT);
    const r = await agent.post("/api/clover/orders").send({ cart: CART });
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
    const r = await agent.post("/api/clover/orders").send({ cart: CART });
    expect(r.status).toBe(200);
    expect(clover.createOrder).toHaveBeenCalled();
  });

  it("refuses right on closing time, not a minute after", async () => {
    const { agent } = proxy(new Date(2026, 6, 27, 22, 0));   // 10:00 PM exactly
    expect((await agent.post("/api/clover/orders").send({ cart: CART })).status).toBe(409);
    const { agent: a2 } = proxy(new Date(2026, 6, 27, 21, 59));
    expect((await a2.post("/api/clover/orders").send({ cart: CART })).status).toBe(200);
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
