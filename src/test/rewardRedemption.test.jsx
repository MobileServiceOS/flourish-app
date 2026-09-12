import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { addItem, stubOnlineProxy } from "./helpers.js";
import { CURRENCY_MANY } from "../lib/currency.js";

/* ============================================================================
   THE CLIENT DOES NOT NAME THE DISCOUNT

   The server owns the reward amount now — it looks the reward up in REWARDS and
   computes the figure from the re-priced cart (see cloverServer.test.js for
   that half). This is the other half: proving the app actually sends an id and
   nothing else. A server that refuses client-named amounts is no use if the
   client keeps sending them and every redemption 400s at the counter.
   ============================================================================ */

const MON_NOON = new Date(2026, 6, 27, 12, 0);

async function launch(stub = {}) {
  vi.setSystemTime(MON_NOON);
  vi.resetModules();
  const calls = stubOnlineProxy({ vi, ...stub });
  const { default: App } = await import("../App.jsx");
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<App />);
  await screen.findByRole("button", { name: /staff/i });
  return { user, calls };
}

/** An account with enough Petals to redeem, already on the device. */
async function seed(points) {
  const { saveAccount } = await import("../lib/storage.js");
  await saveAccount({ name: "Nevaeh Reid", phone: "3478599413", points, orders: [], vouchers: [] });
}

async function placeOrder(user) {
  await user.click(await screen.findByRole("button", { name: /go to checkout/i }));
  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "Nevaeh Reid");
  await user.clear(screen.getByLabelText("Phone number"));
  await user.type(screen.getByLabelText("Phone number"), "3478599413");
  await user.click(screen.getByRole("button", { name: /^Place order/ }));
  await screen.findByText("Order confirmed");
}

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  globalThis.localStorage.clear();
  const { deleteAccount } = await import("../lib/storage.js");
  await deleteAccount();
});
afterEach(() => vi.useRealTimers());

describe("redeeming a reward and ordering with it", () => {
  it("sends the reward id and never an amount", async () => {
    await seed(150);
    const { user, calls } = await launch();

    // Redeem $5 off, which costs 100 and matches any line.
    await user.click(screen.getByRole("button", { name: /^Rewards/ }));
    await screen.findByText(`${CURRENCY_MANY} available`);
    await user.click(screen.getByRole("button", { name: /Redeem \$5 off/i }));

    await user.click(screen.getByRole("button", { name: /^Menu/ }));
    await addItem(user);
    await user.click(await screen.findByRole("button", { name: /cart, 1 item/i }));
    await user.click(await screen.findByRole("button", { name: /Apply reward \$5 off/i }));
    await placeOrder(user);

    expect(calls.orders).toHaveLength(1);
    const body = calls.orders[0];

    expect(body.rewardId).toBe("r-5off");
    /* The whole point. Any of these carrying a figure is the hole the server
       now refuses, and a refusal at the counter is a customer who cannot pay. */
    expect(body.reward).toBeUndefined();
    expect(body.discount).toBeUndefined();
    expect(body.rewardAmount).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/"amount"/);
  });

  it("sends no reward id when nothing was redeemed", async () => {
    const { user, calls } = await launch();
    await addItem(user);
    await user.click(await screen.findByRole("button", { name: /cart, 1 item/i }));
    await placeOrder(user);
    expect(calls.orders[0].rewardId).toBeFalsy();
  });

  it("re-sends the same idempotency key when an order is retried", async () => {
    /* A fresh key on every retry is what turns one lost response into two
       discounted orders on the register. */
    let attempt = 0;
    const { user, calls } = await launch({
      onOrder: () => {
        attempt += 1;
        if (attempt === 1) throw new Error("network went away");
      },
    });

    await addItem(user);
    await user.click(await screen.findByRole("button", { name: /cart, 1 item/i }));
    await user.click(await screen.findByRole("button", { name: /go to checkout/i }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Nevaeh Reid");
    await user.clear(screen.getByLabelText("Phone number"));
    await user.type(screen.getByLabelText("Phone number"), "3478599413");

    await user.click(screen.getByRole("button", { name: /^Place order/ }));
    await waitFor(() => expect(calls.orders.length).toBe(1));

    await user.click(screen.getByRole("button", { name: /^Place order/ }));
    await waitFor(() => expect(calls.orders.length).toBe(2));

    expect(calls.orders[0].idempotencyKey).toBeTruthy();
    expect(calls.orders[1].idempotencyKey).toBe(calls.orders[0].idempotencyKey);
  });

  it("shows the server's discount, not the one it worked out itself", async () => {
    /* If the two ever disagree the register is right, and the confirmation
       screen must not keep claiming otherwise. */
    await seed(150);
    const { user, calls } = await launch({ order: { discount: { name: "$5 off", amount: 2 } } });

    await user.click(screen.getByRole("button", { name: /^Rewards/ }));
    await screen.findByText(`${CURRENCY_MANY} available`);
    await user.click(screen.getByRole("button", { name: /Redeem \$5 off/i }));
    await user.click(screen.getByRole("button", { name: /^Menu/ }));
    await addItem(user);
    await user.click(await screen.findByRole("button", { name: /cart, 1 item/i }));
    await user.click(await screen.findByRole("button", { name: /Apply reward \$5 off/i }));
    await placeOrder(user);

    const { loadAccount } = await import("../lib/storage.js");
    const saved = await loadAccount();
    expect(saved.orders[0].reward.amount).toBe(2);
    expect(calls.orders).toHaveLength(1);
  });
});
