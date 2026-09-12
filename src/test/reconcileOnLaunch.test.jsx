import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { stubOnlineProxy, unpaidOrder } from "./helpers.js";
import { CURRENCY_MANY } from "../lib/currency.js";
import {
  ordersToReconcile, placedAtOf, RECONCILE_WINDOW_MS, RECONCILE_MAX,
} from "../lib/reconcile.js";

/* ============================================================================
   PAID AT THE COUNTER WITH THE APP CLOSED

   Petals are credited when Clover confirms the payment, and that confirmation
   arrived from one place: a poll that only runs while the tracking screen is
   mounted. Which is not what a customer does. They order, lock the phone,
   drive over, pay, and take the food home — and the app was not running at the
   moment of the only event it was waiting for. Those Petals were earned and
   never credited, silently, for every customer who did the normal thing.

   So the recent unpaid orders are re-checked on launch.
   ============================================================================ */

const MON_NOON = new Date(2026, 6, 27, 12, 0);

const storedOrder = (over = {}) => ({
  num: "FL-3412",
  cloverOrderId: "CLOVER1",
  when: "Today",
  total: 21.78,
  status: "preparing",
  placedAt: new Date(MON_NOON.getTime() - 60 * 60_000).toISOString(),  // an hour ago
  readyAt: new Date(MON_NOON.getTime() - 30 * 60_000).toISOString(),
  pickup: "12:10–12:20 PM",
  paidBy: "pickup",
  earnable: 20,
  pointsAwarded: false,
  lines: [],
  ...over,
});

/* Sign the customer in with history already on the device, as a relaunch has.
   Written through the real storage module rather than straight into
   localStorage: the app reads Capacitor Preferences when the plugin is present,
   which it is here, and a hand-seeded localStorage key is simply not read. */
async function seedAccount(orders, points = 0) {
  const { saveAccount } = await import("../lib/storage.js");
  await saveAccount({ name: "Nevaeh Reid", phone: "3478599413", points, orders, vouchers: [] });
}

async function savedAccount() {
  const { loadAccount } = await import("../lib/storage.js");
  return loadAccount();
}

async function relaunch(stub = {}) {
  vi.setSystemTime(MON_NOON);
  vi.resetModules();
  const calls = stubOnlineProxy({ vi, ...stub });
  const { default: App } = await import("../App.jsx");
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<App />);
  await screen.findByRole("button", { name: /staff/i });
  return { user, calls };
}

async function balance(user) {
  await user.click(screen.getByRole("button", { name: /^Rewards/ }));
  const label = await screen.findByText(`${CURRENCY_MANY} available`);
  return Number(label.previousElementSibling.textContent);
}

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  globalThis.localStorage.clear();
  const { deleteAccount } = await import("../lib/storage.js");
  await deleteAccount();
});
afterEach(() => vi.useRealTimers());

/* ---------------------------------------------------------------- selection */

describe("which orders are worth asking about", () => {
  const NOW = MON_NOON.getTime();

  it("takes a recent unpaid order that would earn something", () => {
    expect(ordersToReconcile([storedOrder()], NOW)).toHaveLength(1);
  });

  it("skips one that was already credited", () => {
    // The guard that matters: the tracking screen may have settled it already.
    expect(ordersToReconcile([storedOrder({ pointsAwarded: true })], NOW)).toEqual([]);
  });

  it("skips a guest order, which earns nothing either way", () => {
    expect(ordersToReconcile([storedOrder({ earnable: 0 })], NOW)).toEqual([]);
  });

  it("skips one with no Clover id, because there is nothing to ask", () => {
    expect(ordersToReconcile([storedOrder({ cloverOrderId: null })], NOW)).toEqual([]);
  });

  it("stops at 24 hours", () => {
    const old = new Date(NOW - RECONCILE_WINDOW_MS - 60_000).toISOString();
    const justInside = new Date(NOW - RECONCILE_WINDOW_MS + 60_000).toISOString();
    expect(ordersToReconcile([storedOrder({ placedAt: old, readyAt: old })], NOW)).toEqual([]);
    expect(ordersToReconcile([storedOrder({ placedAt: justInside })], NOW)).toHaveLength(1);
  });

  it("falls back to readyAt for orders stored before placedAt existed", () => {
    /* Those are exactly the customers whose Petals went missing, so dropping
       them for want of a field the old code never wrote would miss the point. */
    const o = storedOrder({ placedAt: undefined });
    expect(Number.isFinite(placedAtOf(o))).toBe(true);
    expect(ordersToReconcile([o], NOW)).toHaveLength(1);
  });

  it("keeps a scheduled order whose window is still ahead", () => {
    const later = new Date(NOW + 3 * 60 * 60_000).toISOString();
    expect(ordersToReconcile([storedOrder({ placedAt: later })], NOW)).toHaveLength(1);
  });

  it("drops one with no usable timestamp rather than checking it forever", () => {
    const o = storedOrder({ placedAt: undefined, readyAt: undefined });
    expect(ordersToReconcile([o], NOW)).toEqual([]);
  });

  it("asks about the newest first, and not more than a handful", () => {
    const many = Array.from({ length: RECONCILE_MAX + 4 }, (_, i) => storedOrder({
      num: `FL-${i}`,
      cloverOrderId: `C${i}`,
      placedAt: new Date(NOW - i * 60_000).toISOString(),
    }));
    const due = ordersToReconcile(many, NOW);
    expect(due).toHaveLength(RECONCILE_MAX);
    expect(due[0].num).toBe("FL-0");
  });

  it("survives junk without throwing", () => {
    expect(ordersToReconcile(null, NOW)).toEqual([]);
    expect(ordersToReconcile([null, undefined, {}], NOW)).toEqual([]);
  });
});

/* ------------------------------------------------------------- the app path */

describe("the launch sweep credits what was paid while the app was shut", () => {
  it("credits an order the register settled overnight", async () => {
    /* The SERVER credits now: asking about a paid order is what makes it settle
       and earn, so the sweep's job is to ask, and the client's job is to show
       whatever the ledger then holds. The stub does what the real server does
       and moves the number. The device no longer keeps a balance to check. */
    await seedAccount([storedOrder()]);
    const { user, calls } = await relaunch({
      petals: 20,
      payment: { ...unpaidOrder(), paid: true, settled: true },
    });

    await waitFor(() => expect(calls.status.length).toBeGreaterThan(0));
    expect(await balance(user)).toBe(20);
  });

  it("leaves an order that is still unpaid alone", async () => {
    await seedAccount([storedOrder()]);
    const { user } = await relaunch({ payment: unpaidOrder() });

    await waitFor(() => expect(screen.getByRole("button", { name: /^Rewards/ })).toBeTruthy());
    expect(await balance(user)).toBe(0);
  });

  it("awards nothing for an order voided at the register", async () => {
    /* `settled` is true for a void as well as a payment, so awarding on the
       wrong flag would credit food that was cancelled. */
    await seedAccount([storedOrder()]);
    const { user } = await relaunch({
      payment: { ...unpaidOrder(), paid: false, voided: true, settled: true },
    });
    expect(await balance(user)).toBe(0);
  });

  it("does not pay twice for one the tracking screen already credited", async () => {
    await seedAccount([storedOrder({ pointsAwarded: true })], 20);
    const { user, calls } = await relaunch({
      payment: { ...unpaidOrder(), paid: true, settled: true },
    });
    expect(await balance(user)).toBe(20);
    expect(calls.status).toEqual([]);   // never even asked
  });

  it("asks about nothing at all when there is no account", async () => {
    // A guest has no balance to credit, so the sweep must not fire.
    const { calls } = await relaunch({ payment: { ...unpaidOrder(), paid: true } });
    await waitFor(() => expect(screen.getByRole("button", { name: /^Sign in/ })).toBeTruthy());
    expect(calls.status).toEqual([]);
  });

  it("asks once per launch, not once per render", async () => {
    await seedAccount([storedOrder()]);
    const { calls } = await relaunch({ payment: { ...unpaidOrder(), paid: true, settled: true } });

    await waitFor(() => expect(calls.status.length).toBe(1));
    // The award rewrites the orders array; a dependency on it would loop.
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls.status.length).toBe(1);
  });
});
