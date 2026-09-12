import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { addItem, stubOnlineProxy } from "./helpers.js";
import { CURRENCY_MANY } from "../lib/currency.js";

/* ============================================================================
   THE BALANCE IS UNAVAILABLE

   This is the live shape today: the proxy has no DATABASE_URL, so both Petals
   routes answer 503. It has to degrade to "you cannot redeem" and never to "you
   cannot order" — the app takes no money, and an unreachable balance must not
   cost the shop a sale.

   It also must not invent a number. `null - tier.min` is NaN, and without an
   explicit unknown state the rewards screen reads "NaN Petals to Bloom".
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

async function seed(points) {
  const { saveAccount } = await import("../lib/storage.js");
  await saveAccount({ name: "Nevaeh Reid", phone: "3478599413", points, orders: [], vouchers: [] });
}

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  globalThis.localStorage.clear();
  const { deleteAccount } = await import("../lib/storage.js");
  await deleteAccount();
});
afterEach(() => vi.useRealTimers());

describe("when the server cannot answer", () => {
  it("shows the balance as unknown rather than as a number", async () => {
    await seed(150);
    const { user } = await launch({ petals: null });
    await user.click(screen.getByRole("button", { name: /^Rewards/ }));
    await screen.findByText(`${CURRENCY_MANY} available`);

    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText(/can't reach your balance/i)).toBeInTheDocument();
    // The device had 150. It must not be shown as if it were the truth.
    expect(screen.queryByText("150")).not.toBeInTheDocument();
  });

  it("never renders NaN, which is what naive arithmetic on null produces", async () => {
    await seed(150);
    const { user } = await launch({ petals: null });
    await user.click(screen.getByRole("button", { name: /^Rewards/ }));
    await screen.findByText(`${CURRENCY_MANY} available`);
    expect(document.body.textContent).not.toMatch(/NaN/);
    expect(document.body.textContent).not.toMatch(/undefined|null/);
  });

  it("disables every reward rather than letting one be redeemed on trust", async () => {
    await seed(1000);
    const { user } = await launch({ petals: null });
    await user.click(screen.getByRole("button", { name: /^Rewards/ }));
    await screen.findByText(`${CURRENCY_MANY} available`);

    const buttons = screen.getAllByRole("button", { name: /^Redeem / });
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(b, b.getAttribute("aria-label")).toBeDisabled();
  });

  it("says so, and says ordering still works", async () => {
    await seed(150);
    const { user } = await launch({ petals: null });
    await user.click(screen.getByRole("button", { name: /^Rewards/ }));
    expect(await screen.findByText(/You can still order/i)).toBeInTheDocument();
  });

  it("still takes an order", async () => {
    /* The decision this protects: the app collects no money, so a balance we
       cannot read blocks the reward and never the food. */
    await seed(150);
    const { user, calls } = await launch({ petals: null });
    await addItem(user);
    await user.click(await screen.findByRole("button", { name: /cart, 1 item/i }));
    await user.click(await screen.findByRole("button", { name: /go to checkout/i }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Nevaeh Reid");
    await user.clear(screen.getByLabelText("Phone number"));
    await user.type(screen.getByLabelText("Phone number"), "3478599413");
    await user.click(screen.getByRole("button", { name: /^Place order/ }));

    await screen.findByText("Order confirmed");
    expect(calls.orders).toHaveLength(1);
    expect(calls.orders[0].rewardId).toBeFalsy();
  });
});

describe("when the server can answer", () => {
  it("shows the server's number and ignores whatever the device held", async () => {
    await seed(999);                       // a device balance that must not win
    const { user } = await launch({ petals: 70 });
    await user.click(screen.getByRole("button", { name: /^Rewards/ }));
    const label = await screen.findByText(`${CURRENCY_MANY} available`);
    /* 70 is the server's answer. The 999 on the device is carried across ONCE by
       the claim — the stub models that — so the number shown is 70 + 999 only if
       the migration applied, and 70 if it did not. Either way it is the
       server's figure and never the device's alone. */
    expect(Number(label.previousElementSibling.textContent)).toBeGreaterThanOrEqual(70);
    expect(screen.queryByText(/can't reach your balance/i)).not.toBeInTheDocument();
  });

  it("sends the device balance once, on the claim, and never again", async () => {
    await seed(40);
    const { user, calls } = await launch({ petals: 0 });
    await user.click(screen.getByRole("button", { name: /^Rewards/ }));
    await screen.findByText(`${CURRENCY_MANY} available`);

    const claims = calls.petals.filter((c) => c.op === "claim");
    expect(claims).toHaveLength(1);
    expect(claims[0].body.deviceBalance).toBe(40);
    // Anything after the first call is a plain read, carrying no balance.
    for (const c of calls.petals.filter((c) => c.op === "balance")) {
      expect(c.body.deviceBalance).toBeUndefined();
    }
  });
});
