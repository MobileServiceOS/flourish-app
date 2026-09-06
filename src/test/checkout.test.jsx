import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { addItem, ACKEE, stubOnlineProxy } from "./helpers.js";

async function renderApp(when = new Date(2026, 6, 27, 12, 0), stub = {}) { // Monday noon
  vi.setSystemTime(when);
  vi.resetModules();
  stubOnlineProxy({ vi, ...stub }); // ordering needs a reachable proxy
  const { default: App } = await import("../App.jsx");
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<App />);
  await screen.findByRole("button", { name: /staff/i });
  return { user };
}

/** Add a no-choices item, then walk to the confirmation screen. */
async function placeOrder(user, { name = "Nevaeh Reid", phone = "3478599413" } = {}) {
  await addItem(user);
  await user.click(await screen.findByRole("button", { name: /cart, 1 item/i }));
  await user.click(await screen.findByRole("button", { name: /go to checkout/i }));

  await user.clear(screen.getByLabelText(/name/i));
  await user.type(screen.getByLabelText(/name/i), name);
  await user.clear(screen.getByLabelText(/phone/i));
  await user.type(screen.getByLabelText(/phone/i), phone);

  await user.click(screen.getByRole("button", { name: /^(Pay|Place order)/ }));
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe("order confirmation", () => {
  it("confirms the order and shows its number", async () => {
    const { user } = await renderApp();
    await placeOrder(user);

    expect(await screen.findByText("Order confirmed")).toBeInTheDocument();
    expect(screen.getByText(/^FL-\d{4}$/)).toBeInTheDocument();
  });

  it("shows the window the kitchen quoted, not a fixed fifteen minutes", async () => {
    const { user } = await renderApp(new Date(2026, 6, 27, 12, 0));
    await placeOrder(user);

    await screen.findByText("Estimated ready time");
    /* Ackee & Shrimp is cooked to order: noon gets 12:30-12:40, where an
       ordinary plate would get 12:15-12:25. The screen shows what the server
       said and never works one out for itself. */
    expect(screen.getByText("12:30–12:40 PM")).toBeInTheDocument();
    expect(screen.getByText(/ready in this window/i)).toBeInTheDocument();
    expect(screen.queryByText(/ASAP/i)).not.toBeInTheDocument();
  });

  it("lists what was ordered", async () => {
    const { user } = await renderApp();
    await placeOrder(user);

    const order = (await screen.findByText("Your order")).nextElementSibling;
    expect(within(order).getByText(new RegExp("1× " + ACKEE.name))).toBeInTheDocument();
  });

  it("gives the pickup address, phone, a maps link and a call button", async () => {
    const { user } = await renderApp();
    await placeOrder(user);

    await screen.findByText("Order confirmed");
    expect(screen.getByText(/4035 Laconia Ave/)).toBeInTheDocument();
    expect(screen.getByText(/Bronx, NY 10466/)).toBeInTheDocument();

    const call = screen.getByRole("link", { name: /call the restaurant/i });
    expect(call).toHaveAttribute("href", "tel:+13478599413");
    expect(screen.getByText("(347) 859-9413")).toBeInTheDocument();

    const maps = screen.getByRole("link", { name: /google maps/i });
    expect(maps).toHaveAttribute("href", expect.stringContaining("google.com/maps"));
    expect(maps).toHaveAttribute("href", expect.stringContaining("Laconia"));
  });

  it("empties the cart once the order is placed", async () => {
    const { user } = await renderApp();
    await placeOrder(user);
    await screen.findByText("Order confirmed");
    await user.click(screen.getByRole("button", { name: "Back to menu" }));
    expect(await screen.findByRole("button", { name: /cart, empty/i })).toBeInTheDocument();
  });
});

describe("tax shown to the customer", () => {
  it("names the rate and totals correctly at 8.5%", async () => {
    const { user } = await renderApp();
    // Ackee & Shrimp is $20.00 flat, two included sides
    await addItem(user);
    await user.click(await screen.findByRole("button", { name: /cart, 1 item/i }));
    await user.click(await screen.findByRole("button", { name: /go to checkout/i }));

    expect(await screen.findByText("Tax (8.875%)")).toBeInTheDocument();
    // default tip is 10% of subtotal = $2.00, so total = 20.00 + 1.78 + 2.00
    const rows = [...document.querySelectorAll(".rowline")].map((r) => r.textContent);
    expect(rows).toContain("Tax (8.875%)$1.78");
    expect(rows).toContain("Total$23.78");

    // and the CTA quotes that same total once the form is valid
    const n = screen.getByLabelText("Name");
    await user.clear(n); await user.type(n, "Nevaeh Reid");
    const p = screen.getByLabelText("Phone number");
    await user.clear(p); await user.type(p, "3478599413");
    expect(screen.getByRole("button", { name: /\$23\.78/ })).toBeEnabled();
  });
});

/* ============================================================================
   The confirmation screen used to tell customers "the kitchen printer didn't
   answer" on orders that had printed perfectly well: the proxy fired a
   print_event naming no printer, Clover routed it nowhere, and the app reported
   the failure of a request the kitchen never needed. The copy is driven off
   what the server actually reports now, so it has to follow the flag both ways.
   ============================================================================ */
describe("what the confirmation says about printing", () => {
  it("says the ticket printed when the server says it printed", async () => {
    const { user } = await renderApp(undefined, { order: { printed: true, printError: null } });
    await placeOrder(user);

    await screen.findByText("Order confirmed");
    expect(screen.getByText(/ticket printed in the kitchen/i)).toBeInTheDocument();
    expect(screen.queryByText(/printer didn't answer/i)).not.toBeInTheDocument();
  });

  it("only blames the printer when the server actually reports a failure", async () => {
    const { user } = await renderApp(undefined, {
      order: { printed: false, printError: "Printer offline" },
    });
    await placeOrder(user);

    await screen.findByText("Order confirmed");
    expect(screen.getByText(/printer didn't answer/i)).toBeInTheDocument();
    // ...and never suggests the order itself was lost.
    expect(screen.getByText(/your order is in/i)).toBeInTheDocument();
  });
});
