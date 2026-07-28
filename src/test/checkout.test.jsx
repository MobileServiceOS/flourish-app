import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

async function renderApp(when = new Date(2026, 6, 27, 12, 0)) { // Monday noon
  vi.setSystemTime(when);
  vi.resetModules();
  const { default: App } = await import("../App.jsx");
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<App />);
  await screen.findByRole("button", { name: /staff/i });
  return { user };
}

/** Add a no-choices item, then walk to the confirmation screen. */
async function placeOrder(user, { name = "Nevaeh Reid", phone = "3478599413" } = {}) {
  await user.click(screen.getByRole("button", { name: /^Add Beef Patty to cart$/ }));
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

  it("shows an estimated ready time about fifteen minutes out", async () => {
    const { user } = await renderApp(new Date(2026, 6, 27, 12, 0));
    await placeOrder(user);

    await screen.findByText("Estimated ready time");
    // ASAP at 12:00 -> ready 12:15
    expect(screen.getByText("12:15 PM")).toBeInTheDocument();
    expect(screen.getByText(/About 15 minutes from now/)).toBeInTheDocument();
  });

  it("lists what was ordered", async () => {
    const { user } = await renderApp();
    await placeOrder(user);

    const order = (await screen.findByText("Your order")).nextElementSibling;
    expect(within(order).getByText(/1× Beef Patty/)).toBeInTheDocument();
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
