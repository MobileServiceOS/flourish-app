import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { stubOnlineProxy, unpaidOrder } from "./helpers.js";
import { CURRENCY_MANY } from "../lib/currency.js";
import { orderBadge } from "../components/OrdersView.jsx";

/* ============================================================================
   THE MOMENT THE APP KEPT MISSING

   Real order FL-5350: paid by card at 7:56, $6.53, and the server credited 6
   Petals. At 8:00 the app still showed "0 Petals available" on Rewards and
   "Preparing" on Orders. The server was right the whole time; the client never
   asked again.

   It fetched on launch and after placing an order — and missed the one moment
   that matters, which is the customer standing at the counter having just paid,
   opening the app to see it.

   Two causes, and the second was worse than a stale fetch: `status` was written
   once at creation as "preparing" and updated by NOTHING, so every order ever
   placed read "Preparing" for the life of the install.
   ============================================================================ */

const MON_NOON = new Date(2026, 6, 27, 12, 0);

const storedOrder = (over = {}) => ({
  num: "FL-5350",
  cloverOrderId: "AS9YCTNNJD916",
  when: "Today",
  total: 6.53,
  status: "preparing",
  placedAt: new Date(MON_NOON.getTime() - 30 * 60_000).toISOString(),
  readyAt: new Date(MON_NOON.getTime() - 15 * 60_000).toISOString(),
  pickup: "11:45–11:55 AM",
  paidBy: "pickup",
  earnable: 6,
  pointsAwarded: false,
  lines: [{ name: "Festival", qty: 1, price: 1.5, meta: "" }],
  ...over,
});

async function seed(orders, points = 0) {
  const { saveAccount } = await import("../lib/storage.js");
  await saveAccount({ name: "Nevaeh Reid", phone: "3478599413", points, orders, vouchers: [] });
}

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

/** What a phone coming back to the foreground produces. */
function wake() {
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event("focus"));
}

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  globalThis.localStorage.clear();
  const { deleteAccount } = await import("../lib/storage.js");
  await deleteAccount();
});
afterEach(() => vi.useRealTimers());

describe("the balance is re-read when the customer looks at it", () => {
  it("asks again when Rewards is opened", async () => {
    /* Asserts the NUMBER ON THE SCREEN, not the request count. Counting
       requests passed with the refresh removed, because a launch fetch still
       settling bumps the count on its own — the test proved nothing. What
       cannot happen by accident is the screen showing a figure the client only
       learned after the customer navigated. */
    await seed([]);
    const { user, calls } = await launch({ petals: 0 });
    await waitFor(() => expect(calls.petals.length).toBeGreaterThan(0));
    await vi.advanceTimersByTimeAsync(50);            // let launch settle

    // The server credits while the app is sitting on the menu.
    calls.setPetals(6);
    await user.click(screen.getByRole("button", { name: /^Rewards/ }));

    const label = await screen.findByText(`${CURRENCY_MANY} available`);
    await waitFor(() => expect(Number(label.previousElementSibling.textContent)).toBe(6));
  });

  it("asks again when the app comes back to the foreground", async () => {
    /* The counter case exactly: the app was open, the customer paid, and the
       phone came back to the foreground. */
    await seed([]);
    const { user, calls } = await launch({ petals: 0 });
    await user.click(screen.getByRole("button", { name: /^Rewards/ }));
    await screen.findByText(`${CURRENCY_MANY} available`);

    calls.setPetals(6);
    const before = calls.petals.length;
    wake();

    await waitFor(() => expect(calls.petals.length).toBeGreaterThan(before));
    const label = screen.getByText(`${CURRENCY_MANY} available`);
    await waitFor(() => expect(Number(label.previousElementSibling.textContent)).toBe(6));
  });

  it("does not ask while the app is hidden", async () => {
    await seed([]);
    const { calls } = await launch({ petals: 0 });
    const before = calls.petals.length;

    const spy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(50);
    expect(calls.petals.length).toBe(before);
    spy.mockRestore();
  });
});

describe("the orders list reflects a payment", () => {
  it("stops saying Preparing once the register reports it paid", async () => {
    await seed([storedOrder()]);
    const { user } = await launch({
      petals: 6,
      payment: { ...unpaidOrder(), paid: true, settled: true },
    });

    await user.click(screen.getByRole("button", { name: /^Orders/ }));
    expect(await screen.findByText("Paid")).toBeInTheDocument();
    expect(screen.queryByText("Preparing")).not.toBeInTheDocument();
  });

  it("re-checks on focus, not only on launch", async () => {
    await seed([storedOrder()]);
    const { user, calls } = await launch({ petals: 0, payment: unpaidOrder() });

    await user.click(screen.getByRole("button", { name: /^Orders/ }));
    expect(await screen.findByText("Preparing")).toBeInTheDocument();

    // The customer pays at the counter, then picks the phone back up.
    calls.setPayment({ paid: true, paymentState: "PAID", amountPaid: 653, settled: true });
    await vi.advanceTimersByTimeAsync(21_000);   // past the re-sweep floor
    wake();

    expect(await screen.findByText("Paid")).toBeInTheDocument();
  });

  it("marks an order cancelled at the register rather than leaving it Preparing", async () => {
    /* Without this a voided order reads as in the kitchen for the life of the
       install, for the same reason the paid one did. */
    await seed([storedOrder()]);
    const { user } = await launch({
      petals: 0,
      payment: { ...unpaidOrder(), paid: false, voided: true, settled: true },
    });

    await user.click(screen.getByRole("button", { name: /^Orders/ }));
    expect(await screen.findByText("Cancelled")).toBeInTheDocument();
  });

  it("does not sweep more often than the floor, however many wakes arrive", async () => {
    await seed([storedOrder()]);
    const { calls } = await launch({ petals: 0, payment: unpaidOrder() });
    await waitFor(() => expect(calls.status.length).toBeGreaterThan(0));
    const after = calls.status.length;

    for (let i = 0; i < 5; i++) wake();
    await vi.advanceTimersByTimeAsync(100);
    expect(calls.status.length, "five wakes inside the floor ask once").toBe(after);
  });
});

describe("the badge says what is actually known", () => {
  it("never claims Completed on the strength of a payment", () => {
    /* The register took the money; that is not the same as the customer having
       collected the food, and saying the stronger thing would invent a fact. */
    expect(orderBadge({ status: "paid" })).toBe("Paid");
    expect(orderBadge({ paidBy: "paid" })).toBe("Paid");
    expect(orderBadge({ pointsAwarded: true })).toBe("Paid");
  });

  it("reads an order recorded by an older build", () => {
    // Before this change only `paidBy` was written. It still has to display.
    expect(orderBadge({ status: "preparing", paidBy: "paid" })).toBe("Paid");
  });

  it("falls back to Preparing, never to blank", () => {
    expect(orderBadge({})).toBe("Preparing");
    expect(orderBadge(undefined)).toBe("Preparing");
  });

  it("shows a cancelled order as cancelled", () => {
    expect(orderBadge({ status: "cancelled" })).toBe("Cancelled");
    expect(orderBadge({ paidBy: "voided" })).toBe("Cancelled");
  });
});
