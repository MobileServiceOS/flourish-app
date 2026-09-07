import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { addItem, stubOnlineProxy, unpaidOrder } from "./helpers.js";

/* ============================================================================
   POINTS ARE EARNED AT THE REGISTER

   The app takes no money. An order leaves this app open and owing, and the
   customer pays at the counter — or walks out and never collects it. Points
   used to be added the moment the order was placed, which gave them away for
   food nobody had paid for.

   They are awarded on one thing only now: Clover confirming the payment.
   ============================================================================ */

const MON_NOON = new Date(2026, 6, 27, 12, 0);

async function renderApp(stub = {}) {
  vi.setSystemTime(MON_NOON);
  vi.resetModules();
  const calls = stubOnlineProxy({ vi, ...stub });
  const { default: App } = await import("../App.jsx");
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<App />);
  await screen.findByRole("button", { name: /staff/i });
  return { user, calls };
}

/** Join Flourish Rewards, so there is an account for points to land in. */
async function signIn(user) {
  // The tab reads "Sign in" until there is an account, "Rewards" after.
  await user.click(screen.getByRole("button", { name: /^Sign in/ }));
  await user.type(await screen.findByLabelText("Full name"), "Nevaeh Reid");
  await user.type(screen.getByLabelText("Phone number"), "3478599413");
  await user.click(screen.getByRole("button", { name: /Create my account/ }));
  await screen.findByText("points available");
}

async function placeOrder(user) {
  await user.click(screen.getByRole("button", { name: /^Menu/ }));
  await addItem(user);
  await user.click(await screen.findByRole("button", { name: /cart, 1 item/i }));
  await user.click(await screen.findByRole("button", { name: /go to checkout/i }));
  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "Nevaeh Reid");
  await user.clear(screen.getByLabelText("Phone number"));
  await user.type(screen.getByLabelText("Phone number"), "3478599413");
  await user.click(screen.getByRole("button", { name: /^Place order/ }));
  await screen.findByText("Order confirmed");
}

/** The points balance on the Rewards screen. */
async function pointsBalance(user) {
  // The tab bar is hidden on the confirmation screen, so leave it first.
  const done = screen.queryByRole("button", { name: /Done, back to menu/ });
  if (done) await user.click(done);
  await user.click(screen.getByRole("button", { name: /^Rewards/ }));
  const label = await screen.findByText("points available");
  return Number(label.previousElementSibling.textContent);
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe("points are not awarded when the order is placed", () => {
  it("adds nothing to the balance for an unpaid order", async () => {
    const { user } = await renderApp();
    await signIn(user);
    expect(await pointsBalance(user)).toBe(0);

    await placeOrder(user);
    // Ackee & Shrimp is $20, so this order is worth 20 points — later.
    expect(await pointsBalance(user)).toBe(0);
  });

  it("says the points are coming, rather than claiming they arrived", async () => {
    const { user } = await renderApp();
    await signIn(user);
    await placeOrder(user);

    expect(screen.getByText(/You'll earn 20 points when you pay/i)).toBeInTheDocument();
    expect(screen.queryByText(/Points earned!/)).not.toBeInTheDocument();
  });

  it("asks the register whether it has been paid for", async () => {
    const { user, calls } = await renderApp();
    await signIn(user);
    await placeOrder(user);

    await waitFor(() => expect(calls.status.length).toBeGreaterThan(0));
    expect(calls.status[0]).toBe("CLV-TEST");
  });
});

describe("points are awarded when Clover confirms payment", () => {
  it("adds them to the balance and says so on the tracking screen", async () => {
    const { user, calls } = await renderApp();
    await signIn(user);
    await placeOrder(user);
    expect(screen.queryByText(/Points earned!/)).not.toBeInTheDocument();

    // The customer hands over a card at the counter.
    calls.setPayment({ paid: true, paymentState: "PAID", amountPaid: 2000, settled: true });
    await vi.advanceTimersByTimeAsync(30_000);

    expect(await screen.findByText(/Points earned!/)).toBeInTheDocument();
    expect(screen.getByText(/\+20 points added for this order/)).toBeInTheDocument();
    expect(await pointsBalance(user)).toBe(20);
  });

  it("awards them exactly once, however many times the poll comes back paid", async () => {
    const { user, calls } = await renderApp();
    await signIn(user);
    await placeOrder(user);

    calls.setPayment({ paid: true, paymentState: "PAID", amountPaid: 2000, settled: true });
    await vi.advanceTimersByTimeAsync(30_000);
    await screen.findByText(/Points earned!/);
    // Several more polling intervals go by.
    await vi.advanceTimersByTimeAsync(120_000);

    expect(await pointsBalance(user)).toBe(20);
  });

  it("counts a split payment that adds up to the total", async () => {
    // paymentState stays OPEN while the payments themselves cover the bill.
    const { user, calls } = await renderApp();
    await signIn(user);
    await placeOrder(user);

    calls.setPayment({ paid: true, paymentState: "OPEN", amountPaid: 2000, settled: true });
    await vi.advanceTimersByTimeAsync(30_000);

    expect(await screen.findByText(/Points earned!/)).toBeInTheDocument();
  });
});

describe("polling stops once the answer is final", () => {
  it("stops asking after the payment is confirmed", async () => {
    const { user, calls } = await renderApp();
    await signIn(user);
    await placeOrder(user);

    calls.setPayment({ paid: true, paymentState: "PAID", amountPaid: 2000, settled: true });
    await vi.advanceTimersByTimeAsync(30_000);
    await screen.findByText(/Points earned!/);

    const afterPaid = calls.status.length;
    await vi.advanceTimersByTimeAsync(5 * 60_000);   // ten more intervals
    expect(calls.status.length).toBe(afterPaid);
  });

  it("stops asking after the order is voided", async () => {
    const { user, calls } = await renderApp({
      payment: { ...unpaidOrder(), voided: true, state: "deleted", settled: true },
    });
    await signIn(user);
    await placeOrder(user);

    await waitFor(() => expect(calls.status.length).toBeGreaterThan(0));
    const afterVoid = calls.status.length;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(calls.status.length).toBe(afterVoid);
  });

  it("keeps asking while the order is still open and owing", async () => {
    const { user, calls } = await renderApp();
    await signIn(user);
    await placeOrder(user);

    await waitFor(() => expect(calls.status.length).toBeGreaterThan(0));
    const first = calls.status.length;
    await vi.advanceTimersByTimeAsync(90_000);       // three more intervals
    expect(calls.status.length).toBeGreaterThan(first);
  });
});

describe("a voided order earns nothing", () => {
  it("awards no points when the order is cancelled at the register", async () => {
    const { user, calls } = await renderApp({
      payment: { ...unpaidOrder(), voided: true, state: "deleted", settled: true },
    });
    await signIn(user);
    await placeOrder(user);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(screen.queryByText(/Points earned!/)).not.toBeInTheDocument();
    expect(await pointsBalance(user)).toBe(0);
    expect(calls.status.length).toBeGreaterThan(0);
  });

  it("tells the customer why, rather than leaving the promise hanging", async () => {
    const { user } = await renderApp({
      payment: { ...unpaidOrder(), voided: true, state: "deleted", settled: true },
    });
    await signIn(user);
    await placeOrder(user);

    expect(await screen.findByText(/cancelled at the register, so no points/i))
      .toBeInTheDocument();
  });

  it("awards nothing when the order was deleted and Clover 404s it", async () => {
    // The proxy turns a 404 into a settled, voided answer rather than an error.
    const { user } = await renderApp({
      payment: { ...unpaidOrder(), voided: true, state: "deleted", settled: true, total: 0 },
    });
    await signIn(user);
    await placeOrder(user);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(await pointsBalance(user)).toBe(0);
  });
});

describe("the award happens exactly once", () => {
  it("survives a relaunch without paying the points twice", async () => {
    const { user, calls } = await renderApp();
    await signIn(user);
    await placeOrder(user);

    calls.setPayment({ paid: true, paymentState: "PAID", amountPaid: 2000, settled: true });
    await vi.advanceTimersByTimeAsync(30_000);
    await screen.findByText(/Points earned!/);
    expect(await pointsBalance(user)).toBe(20);

    /* The order is stored with pointsAwarded set, which is the guard that
       matters across launches — the in-memory one dies with the session. */
    // Read it back the way the app does — Capacitor Preferences owns the key.
    const { loadAccount } = await import("../lib/storage.js");
    const saved = await loadAccount();
    expect(saved.points).toBe(20);
    expect(saved.orders[0].pointsAwarded).toBe(true);
    expect(saved.orders[0].earnable).toBe(20);

    // Cold start against that same stored account.
    cleanup();
    vi.resetModules();
    stubOnlineProxy({ vi, payment: { ...unpaidOrder(), paid: true, settled: true } });
    const { default: App2 } = await import("../App.jsx");
    render(<App2 />);
    await screen.findByRole("button", { name: /staff/i });
    await vi.advanceTimersByTimeAsync(120_000);

    const user2 = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    expect(await pointsBalance(user2)).toBe(20);
  });
});

describe("a guest earns nothing at all", () => {
  it("shows no points messaging and keeps no balance", async () => {
    const { user } = await renderApp();
    await placeOrder(user);           // never signed in

    expect(screen.queryByText(/You'll earn/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Points earned!/)).not.toBeInTheDocument();
  });
});
