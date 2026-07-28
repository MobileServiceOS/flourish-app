import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { formatPhone, phoneDigits, isValidPhone, isValidName } from "../lib/phone.js";

const MON_NOON = new Date(2026, 6, 27, 12, 0);

async function renderApp(when = MON_NOON) {
  vi.setSystemTime(when);
  vi.resetModules();
  const { default: App } = await import("../App.jsx");
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const utils = render(<App />);
  await screen.findByRole("button", { name: /staff/i });
  return { user, ...utils };
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

/* ---------- 12. empty states ---------- */
describe("empty states", () => {
  it("empty cart offers a way back to the menu", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole("button", { name: /cart, empty/i }));

    expect(await screen.findByText("Your cart is empty")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Browse menu" }));
    expect(await screen.findByRole("tab", { name: "Popular" })).toBeInTheDocument();
  });

  it("no orders offers a way to start one", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole("button", { name: /^Orders$/ }));

    expect(await screen.findByText("No orders yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start your first order" }));
    expect(await screen.findByRole("tab", { name: "Popular" })).toBeInTheDocument();
  });

  it("no search results offers a way to clear", async () => {
    const { user } = await renderApp();
    await user.type(screen.getByLabelText("Search menu"), "qqqq");
    expect(await screen.findByText("No items match")).toBeInTheDocument();
    expect(screen.getByText(/Nothing on the menu matches "qqqq"/)).toBeInTheDocument();
  });
});

/* ---------- 13. loading ---------- */
describe("launch", () => {
  it("shows the branded splash rather than flashing the sign-in screen", async () => {
    // hold storage open so the splash is observable
    let release;
    vi.resetModules();
    vi.doMock("../lib/storage.js", () => ({
      loadAccount: () => new Promise((r) => { release = () => r({ name: "Nevaeh Reid", phone: "3478599413", since: "Jul 2026", points: 120, orders: [], vouchers: [] }); }),
      saveAccount: vi.fn(),
    }));
    const { default: App } = await import("../App.jsx");
    render(<App />);

    expect(screen.getByRole("status", { name: /loading flourish/i })).toBeInTheDocument();
    expect(screen.getByText("Flourish")).toBeInTheDocument();
    // the sign-up pitch must never appear for a customer who already has an account
    expect(screen.queryByText(/Join Flourish Rewards/)).not.toBeInTheDocument();

    release();
    await waitFor(() => expect(screen.queryByRole("status", { name: /loading/i })).not.toBeInTheDocument());
    vi.doUnmock("../lib/storage.js");
  });
});

/* ---------- 14. input validation ---------- */
describe("phone formatting", () => {
  it("formats progressively as digits arrive", () => {
    expect(formatPhone("")).toBe("");
    expect(formatPhone("3")).toBe("(3");
    expect(formatPhone("347")).toBe("(347");
    expect(formatPhone("3478")).toBe("(347) 8");
    expect(formatPhone("347859")).toBe("(347) 859");
    expect(formatPhone("3478599413")).toBe("(347) 859-9413");
  });

  it("ignores anything that is not a digit and stops at ten", () => {
    expect(formatPhone("(347) 859-9413")).toBe("(347) 859-9413");
    expect(formatPhone("347-859-9413999")).toBe("(347) 859-9413");
    expect(phoneDigits("+1 (347) 859 9413")).toBe("1347859941");
  });

  it("survives backspacing through a separator", () => {
    // "(347) 859-9" minus its last char, refed through the formatter
    expect(formatPhone("(347) 859-")).toBe("(347) 859");
    expect(formatPhone("(347) ")).toBe("(347");
  });

  it("validates", () => {
    expect(isValidPhone("3478599413")).toBe(true);
    expect(isValidPhone("347859941")).toBe(false);
    expect(isValidName("Jo")).toBe(true);
    expect(isValidName("J")).toBe(false);
    expect(isValidName("  ")).toBe(false);
  });
});

describe("sign up", () => {
  it("formats the number in the field as the customer types", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole("button", { name: /^Sign in$/ }));

    const phone = await screen.findByLabelText("Phone number");
    await user.type(phone, "3478599413");
    expect(phone).toHaveValue("(347) 859-9413");
  });

  it("keeps submit disabled until both fields are valid", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole("button", { name: /^Sign in$/ }));

    const submit = await screen.findByRole("button", { name: /Enter your name/ });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText("Full name"), "J");
    expect(screen.getByRole("button", { name: /Enter your name/ })).toBeDisabled();

    await user.type(screen.getByLabelText("Full name"), "o");
    expect(screen.getByRole("button", { name: /Enter your phone number/ })).toBeDisabled();

    await user.type(screen.getByLabelText("Phone number"), "347859941");
    expect(screen.getByRole("button", { name: /Enter your phone number/ })).toBeDisabled();

    await user.type(screen.getByLabelText("Phone number"), "3");
    expect(screen.getByRole("button", { name: "Create my account" })).toBeEnabled();
  });

  it("only complains about a field once it has been left", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole("button", { name: /^Sign in$/ }));

    const name = await screen.findByLabelText("Full name");
    await user.type(name, "J");
    expect(screen.queryByText(/at least 2 characters/)).not.toBeInTheDocument();

    await user.tab();
    expect(await screen.findByText(/at least 2 characters/)).toBeInTheDocument();
    expect(name).toHaveAttribute("aria-invalid", "true");
  });
});

/* ---------- 15. accessibility ---------- */
describe("accessibility", () => {
  it("closes the item sheet with Escape", async () => {
    const { user } = await renderApp();
    const lunch = document.querySelector('section[data-cat="Lunch & Dinner"]');
    await user.click(within(lunch).getByRole("button", { name: /^Choose options for Oxtail$/ }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("closes the staff sheet with Escape", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole("button", { name: /staff/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("returns focus to the button that opened the sheet", async () => {
    const { user } = await renderApp();
    const staff = screen.getByRole("button", { name: /staff/i });
    await user.click(staff);
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(staff).toHaveFocus());
  });

  it("marks the sheet as a modal dialog with a name", async () => {
    const { user } = await renderApp();
    const lunch = document.querySelector('section[data-cat="Lunch & Dinner"]');
    await user.click(within(lunch).getByRole("button", { name: /^Choose options for Oxtail$/ }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Oxtail");
  });

  it("lets an item be added from the keyboard alone", async () => {
    const { user } = await renderApp();
    const row = screen.getAllByRole("button", { name: /^Beef Patty, .*from \$/ })[0];
    row.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("button", { name: /cart, 1 item/i })).toBeInTheDocument();
  });

  it("gives every icon-only control an accessible name", async () => {
    await renderApp();
    for (const b of screen.getAllByRole("button")) {
      expect(b, b.outerHTML.slice(0, 90)).toHaveAccessibleName();
    }
  });

  it("names the current tab for screen readers", async () => {
    const { user } = await renderApp();
    expect(screen.getByRole("button", { name: /^Menu$/ })).toHaveAttribute("aria-current", "page");
    await user.click(screen.getByRole("button", { name: /^Orders$/ }));
    expect(screen.getByRole("button", { name: /^Orders$/ })).toHaveAttribute("aria-current", "page");
  });
});

/* ---------- 16. meta tags ---------- */
describe("share preview metadata", () => {
  const html = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../index.html"), "utf8"
  );
  const meta = (attr, key) =>
    html.match(new RegExp(`<meta\\s+${attr}="${key}"\\s+content="([^"]*)"`))?.[1];

  it("has the agreed og:title and description", () => {
    expect(meta("property", "og:title")).toBe("Flourish BX — Order Pickup");
    expect(meta("property", "og:description")).toBe(
      "Caribbean soul food from the Bronx. No delivery fees, no markup. Pickup at 4035 Laconia Ave."
    );
  });

  it("points og:image at a real image, not a placeholder", () => {
    const img = meta("property", "og:image");
    expect(img).toContain("img.cdn4dd.com");
    expect(img).toContain("width=1200,height=672");
    expect(html).not.toContain("flourish.app/og-image.png");
  });

  it("uses the brand theme colour", () => {
    expect(meta("name", "theme-color")).toBe("#8E5BC4");
  });

  it("mirrors the card onto Twitter", () => {
    expect(meta("name", "twitter:card")).toBe("summary_large_image");
    expect(meta("name", "twitter:image")).toBe(meta("property", "og:image"));
  });
});
