import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { stubOnlineProxy, unpaidOrder } from "./helpers.js";
import { CURRENCY_MANY } from "../lib/currency.js";

/* ============================================================================
   ONE PAST ORDER, IN FULL

   The list is a summary; this is the screen a customer opens when something is
   wrong. So the bar is that everything they were charged for is on it, stated
   the way it was ordered, plus the two ids staff can search on.

   The thing worth protecting is WHERE each number comes from. The lines,
   prices, window and vehicle are the order AS PLACED, read from the stored
   copy — re-deriving them from today's menu would restate an old order at
   today's prices. Status and Petals come from the server, because they change
   after the order is placed.
   ============================================================================ */

const MON_NOON = new Date(2026, 6, 27, 12, 0);

const order = (over = {}) => ({
  num: "FL-5350",
  cloverOrderId: "AS9YCTNNJD916",
  when: "Today",
  total: 27.2,
  status: "preparing",
  placedAt: new Date(MON_NOON.getTime() - 20 * 60_000).toISOString(),
  readyAt: new Date(MON_NOON.getTime() - 5 * 60_000).toISOString(),
  pickup: "11:55–12:05 PM",
  scheduled: false,
  tip: 2,
  paidBy: "pickup",
  earnable: 20,
  pointsAwarded: false,
  printed: true,
  reward: null,
  curbside: null,
  lines: [
    { name: "Oxtail", qty: 1, price: 20, meta: "Oxtail Size: Large; Side With Meal: White Rice", note: "no pepper" },
    { name: "Side", qty: 1, price: 5, meta: "Side: Mac & Cheese", note: "" },
  ],
  ...over,
});

async function openDetail(orders, stub = {}) {
  vi.setSystemTime(MON_NOON);
  vi.resetModules();
  const { saveAccount } = await import("../lib/storage.js");
  await saveAccount({ name: "Nevaeh Reid", phone: "3478599413", points: 0, orders, vouchers: [] });
  const calls = stubOnlineProxy({ vi, ...stub });
  const { default: App } = await import("../App.jsx");
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<App />);
  await screen.findByRole("button", { name: /staff/i });
  await user.click(screen.getByRole("button", { name: /^Orders/ }));
  await user.click(await screen.findByRole("button", { name: /Order FL-5350.*see details/i }));
  return { user, calls };
}

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  globalThis.localStorage.clear();
  const { deleteAccount } = await import("../lib/storage.js");
  await deleteAccount();
});
afterEach(() => vi.useRealTimers());

describe("opening a past order", () => {
  it("opens from the list, by tap and by keyboard", async () => {
    const { user } = await openDetail([order()]);
    expect(await screen.findByText("What you ordered")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /back/i }));
    const card = await screen.findByRole("button", { name: /Order FL-5350.*see details/i });
    card.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByText("What you ordered")).toBeInTheDocument();
  });

  it("does not open the detail when Reorder is tapped", async () => {
    /* Reorder stays on the list and must not be swallowed by the card's own
       click target — it is the thing people come to this screen to do. */
    vi.setSystemTime(MON_NOON);
    vi.resetModules();
    const { saveAccount } = await import("../lib/storage.js");
    await saveAccount({ name: "Nevaeh Reid", phone: "3478599413", points: 0, orders: [order()], vouchers: [] });
    stubOnlineProxy({ vi });
    const { default: App } = await import("../App.jsx");
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    await screen.findByRole("button", { name: /staff/i });
    await user.click(screen.getByRole("button", { name: /^Orders/ }));
    await user.click(screen.getByRole("button", { name: /Reorder FL-5350/i }));

    expect(screen.queryByText("What you ordered")).not.toBeInTheDocument();
  });
});

describe("every line, as it was ordered", () => {
  it("shows size, sides and the special instruction", async () => {
    await openDetail([order()]);
    expect(await screen.findByText(/Oxtail Size: Large; Side With Meal: White Rice/)).toBeInTheDocument();
    expect(screen.getByText("no pepper")).toBeInTheDocument();
    expect(screen.getByText(/1× Oxtail/)).toBeInTheDocument();
    expect(screen.getByText(/1× Side/)).toBeInTheDocument();
  });

  it("totals from the stored lines, not from today's menu", async () => {
    /* An old order restated at today's prices is a receipt that disagrees with
       what the customer paid. */
    await openDetail([order()]);
    expect(await screen.findByText("$25.00")).toBeInTheDocument();   // 20 + 5 subtotal
    expect(screen.getByText("$27.20")).toBeInTheDocument();          // the stored total
  });

  it("calls the tax an estimate, because the register is the authority", async () => {
    await openDetail([order()]);
    expect(await screen.findByText(/Tax \(8\.875%, estimated\)/)).toBeInTheDocument();
  });
});

describe("the pickup window and curbside", () => {
  it("shows the window it was given", async () => {
    await openDetail([order()]);
    expect(await screen.findByText("11:55–12:05 PM")).toBeInTheDocument();
  });

  it("names the vehicle when it was curbside", async () => {
    await openDetail([order({ curbside: { vehicle: "Blue Honda Civic · ABC1234" } })]);
    expect(await screen.findByText(/Curbside — Blue Honda Civic · ABC1234/)).toBeInTheDocument();
  });

  it("says nothing about curbside when it was not", async () => {
    await openDetail([order()]);
    await screen.findByText("What you ordered");
    expect(screen.queryByText(/Curbside/)).not.toBeInTheDocument();
  });
});

describe("Petals on the order", () => {
  it("says what it will earn, and that it is not credited yet", async () => {
    await openDetail([order()]);
    expect(await screen.findByText("Earns when paid")).toBeInTheDocument();
    expect(screen.getByText(`20 ${CURRENCY_MANY}`)).toBeInTheDocument();
    expect(screen.getByText(/Credited once the register confirms/)).toBeInTheDocument();
  });

  it("says earned once the register has confirmed it", async () => {
    await openDetail([order({ pointsAwarded: true, status: "paid", paidBy: "paid" })]);
    expect(await screen.findByText("Earned")).toBeInTheDocument();
    expect(screen.queryByText(/Credited once the register/)).not.toBeInTheDocument();
  });

  it("shows a redeemed reward and what it took off", async () => {
    await openDetail([order({ reward: { name: "Free plate", code: "FL1234", amount: 20 } })]);
    expect(await screen.findByText(/Free plate \(−\$20\.00\)/)).toBeInTheDocument();
  });

  it("explains a cancelled order rather than leaving the Petals ambiguous", async () => {
    await openDetail([order({ status: "cancelled", paidBy: "voided" })]);
    expect(await screen.findByText(/cancelled, so nothing was earned/)).toBeInTheDocument();
  });
});

describe("what staff need to find it", () => {
  it("shows the order number and the Clover id", async () => {
    await openDetail([order()]);
    expect(await screen.findByRole("button", { name: /Copy order number FL-5350/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy Clover id AS9YCTNNJD916/ })).toBeInTheDocument();
    // On screen, not hidden behind a tap: they get read out over a counter.
    expect(screen.getByText("AS9YCTNNJD916")).toBeInTheDocument();
  });

  it("shows the current status", async () => {
    await openDetail([order({ status: "paid", paidBy: "paid" })]);
    expect(await screen.findByText("What you ordered")).toBeInTheDocument();
    expect(screen.getAllByText("Paid").length).toBeGreaterThan(0);
  });
});

describe("the detail follows the live order, not a snapshot", () => {
  it("shows Paid once the sweep updates the order behind it", async () => {
    /* A copy frozen when the card was tapped would still read "Preparing"
       while the list behind it said "Paid". */
    const { user } = await openDetail([order()], {
      petals: 20,
      payment: { ...unpaidOrder(), paid: true, settled: true },
    });
    expect(await screen.findByText("What you ordered")).toBeInTheDocument();
    expect(await screen.findAllByText("Paid")).not.toHaveLength(0);
  });
});
