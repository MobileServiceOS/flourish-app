import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const MON_NOON = new Date(2026, 6, 27, 12, 0);   // Monday
const FRI_NOON = new Date(2026, 6, 31, 12, 0);   // Friday
const MON_NIGHT = new Date(2026, 6, 27, 23, 30); // Monday, after close

async function renderApp(when = MON_NOON) {
  vi.setSystemTime(when);
  vi.resetModules();
  const { default: App } = await import("../App.jsx");
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<App />);
  await screen.findByRole("button", { name: /staff/i });
  return { user };
}

/** Oxtail through the options sheet, so the line carries modifiers and a note. */
async function addOxtailWithNote(user, note = "no pepper") {
  const lunch = document.querySelector('section[data-cat="Lunch & Dinner"]');
  await user.click(within(lunch).getByRole("button", { name: /^Choose options for Oxtail$/ }));
  const sheet = await screen.findByRole("dialog");
  await user.type(within(sheet).getByPlaceholderText(/extra gravy/i), note);
  await user.click(within(sheet).getByRole("button", { name: /^Add · \$/ }));
}

async function fillDetails(user, name = "Nevaeh Reid", phone = "3478599413") {
  const n = screen.getByLabelText("Name");
  await user.clear(n); await user.type(n, name);
  const p = screen.getByLabelText("Phone number");
  await user.clear(p); await user.type(p, phone);
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe("special instructions", () => {
  it("carries the note from the item sheet into the cart", async () => {
    const { user } = await renderApp();
    await addOxtailWithNote(user, "extra gravy");
    await user.click(await screen.findByRole("button", { name: /cart, 1 item/i }));
    expect(await screen.findByText(/extra gravy/)).toBeInTheDocument();
  });

  it("carries the note onto the order summary the kitchen reads", async () => {
    const { user } = await renderApp();
    await addOxtailWithNote(user, "no pepper");
    await user.click(await screen.findByRole("button", { name: /cart, 1 item/i }));
    await user.click(await screen.findByRole("button", { name: /go to checkout/i }));
    await fillDetails(user);
    await user.click(screen.getByRole("button", { name: /^(Pay|Place order)/ }));

    const summary = (await screen.findByText("Your order")).nextElementSibling;
    expect(within(summary).getByText(/no pepper/)).toBeInTheDocument();
  });
});

describe("reorder", () => {
  it("puts the whole order back, keeping modifiers and notes", async () => {
    const { user } = await renderApp();
    await addOxtailWithNote(user, "no pepper");
    await user.click(await screen.findByRole("button", { name: /cart, 1 item/i }));
    await user.click(await screen.findByRole("button", { name: /go to checkout/i }));
    await fillDetails(user);
    await user.click(screen.getByRole("button", { name: /^(Pay|Place order)/ }));
    await screen.findByText("Order confirmed");

    // back out, then reorder from history
    await user.click(screen.getByRole("button", { name: "Back to menu" }));
    await user.click(screen.getByRole("button", { name: /^Orders$/ }));
    await user.click(await screen.findByRole("button", { name: /^Reorder FL-/ }));

    // lands in the cart with the line intact
    expect(await screen.findByText(/no pepper/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cart, 1 item/i })).toBeInTheDocument();
    // the size/side modifiers came back too
    expect(screen.getByText(/Medium/)).toBeInTheDocument();
  });

  it("leaves out anything sold out today and says which", async () => {
    const { user } = await renderApp();
    await user.click(screen.getByRole("button", { name: /^Add Beef Patty to cart$/ }));
    await user.click(await screen.findByRole("button", { name: /cart, 1 item/i }));
    await user.click(await screen.findByRole("button", { name: /go to checkout/i }));
    await fillDetails(user);
    await user.click(screen.getByRole("button", { name: /^(Pay|Place order)/ }));
    await screen.findByText("Order confirmed");
    await user.click(screen.getByRole("button", { name: "Back to menu" }));

    // 86 the Beef Patty from the kitchen sheet
    await user.click(screen.getByRole("button", { name: /staff/i }));
    const staff = await screen.findByRole("dialog");
    await user.click(within(staff).getByRole("switch", { name: /^Beef Patty, in stock$/ }));
    await user.click(within(staff).getByRole("button", { name: /close kitchen/i }));

    await user.click(screen.getByRole("button", { name: /^Orders$/ }));
    await user.click(await screen.findByRole("button", { name: /^Reorder FL-/ }));

    expect(await screen.findByText(/Nothing from that order is available today/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cart, empty/i })).toBeInTheDocument();
  });
});

describe("seafood friday", () => {
  it("marks the chip (Fri) on other days", async () => {
    await renderApp(MON_NOON);
    expect(screen.getByRole("tab", { name: "Seafood Fridays (Fri)" })).toBeInTheDocument();
    expect(screen.queryByText(/It's Seafood Friday/)).not.toBeInTheDocument();
  });

  it("leads with seafood and banners it on a Friday", async () => {
    await renderApp(FRI_NOON);
    expect(screen.getByText("It's Seafood Friday!")).toBeInTheDocument();

    const chips = screen.getAllByRole("tab");
    expect(chips[0]).toHaveTextContent("Seafood Fridays");
    // and it is the one selected by default
    expect(chips[0]).toHaveAttribute("aria-selected", "true");
    // no "(Fri)" qualifier on the day itself
    expect(chips[0].textContent).not.toContain("(Fri)");
  });

  it("greys out Friday-only items on a Monday", async () => {
    const { user } = await renderApp(MON_NOON);
    const section = document.querySelector('section[data-cat="Seafood Fridays"]');
    expect(section.textContent).toContain("FRI ONLY");

    const row = within(section).getAllByRole("button", { name: /Crab Legs Platter/ })[0];
    await user.click(row);
    expect(await screen.findByText(/available fri only/i)).toBeInTheDocument();
  });
});

describe("pickup time", () => {
  it("defaults to ASAP with the fifteen minute estimate", async () => {
    const { user } = await renderApp(MON_NOON);
    await user.click(screen.getByRole("button", { name: /^Add Beef Patty to cart$/ }));
    await user.click(await screen.findByRole("button", { name: /cart, 1 item/i }));
    await user.click(await screen.findByRole("button", { name: /go to checkout/i }));

    const asap = screen.getByRole("button", { name: /ASAP/ });
    expect(asap).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Ready around 12:15 PM/)).toBeInTheDocument();
  });

  it("offers quarter-hour slots up to close and no further", async () => {
    const { user } = await renderApp(MON_NOON);
    await user.click(screen.getByRole("button", { name: /^Add Beef Patty to cart$/ }));
    await user.click(await screen.findByRole("button", { name: /cart, 1 item/i }));
    await user.click(await screen.findByRole("button", { name: /go to checkout/i }));

    const select = screen.getByLabelText(/schedule it/i);
    const opts = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(opts[0]).toBe("ASAP (~15 min)");
    expect(opts[1]).toBe("12:15 PM");
    expect(opts[2]).toBe("12:30 PM");
    expect(opts[opts.length - 1]).toBe("10:00 PM");   // Monday close
    expect(opts).not.toContain("10:15 PM");
  });

  it("keeps the same last slot on a Friday", async () => {
    const { user } = await renderApp(FRI_NOON);
    await user.click(screen.getAllByRole("button", { name: /^Add Beef Patty to cart$/ })[0]);
    await user.click(await screen.findByRole("button", { name: /cart, 1 item/i }));
    await user.click(await screen.findByRole("button", { name: /go to checkout/i }));

    const opts = within(screen.getByLabelText(/schedule it/i))
      .getAllByRole("option").map((o) => o.textContent);
    expect(opts[opts.length - 1]).toBe("10:00 PM");
  });

  it("scheduling a slot puts that time on the confirmation", async () => {
    const { user } = await renderApp(MON_NOON);
    await user.click(screen.getByRole("button", { name: /^Add Beef Patty to cart$/ }));
    await user.click(await screen.findByRole("button", { name: /cart, 1 item/i }));
    await user.click(await screen.findByRole("button", { name: /go to checkout/i }));

    const select = screen.getByLabelText(/schedule it/i);
    const target = within(select).getByRole("option", { name: "1:30 PM" });
    await user.selectOptions(select, target.value);
    await fillDetails(user);
    await user.click(screen.getByRole("button", { name: /^(Pay|Place order)/ }));

    await screen.findByText("Estimated ready time");
    expect(screen.getByText("1:30 PM")).toBeInTheDocument();
    expect(screen.getByText(/Scheduled pickup/)).toBeInTheDocument();
  });

  it("refuses to take an order outside opening hours", async () => {
    const { user } = await renderApp(MON_NIGHT);
    await user.click(screen.getByRole("button", { name: /^Add Beef Patty to cart$/ }));
    await user.click(await screen.findByRole("button", { name: /cart, 1 item/i }));
    await user.click(await screen.findByRole("button", { name: /go to checkout/i }));

    expect(await screen.findByText("We're closed right now")).toBeInTheDocument();
    expect(screen.getByText(/opens tomorrow at 9:00 AM/)).toBeInTheDocument();

    const pay = screen.getByRole("button", { name: /Closed until 9:00 AM/ });
    expect(pay).toBeDisabled();
  });
});

describe("sharing", () => {
  it("uses the native share sheet with the agreed copy", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share });
    vi.resetModules();
    const { shareFlourish, SHARE_TEXT, SHARE_URL } = await import("../lib/share.js");

    await expect(shareFlourish({ share })).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ text: SHARE_TEXT, url: SHARE_URL }));
    expect(SHARE_TEXT).toBe(
      "Order pickup from Flourish BX — real Caribbean food, no delivery app markup. https://flourishbx.com"
    );
    vi.unstubAllGlobals();
  });

  it("falls back to the clipboard when there is no share sheet", async () => {
    vi.resetModules();
    const { shareFlourish, SHARE_TEXT } = await import("../lib/share.js");
    const writeText = vi.fn().mockResolvedValue(undefined);

    await expect(shareFlourish({ clipboard: { writeText } })).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith(SHARE_TEXT);
  });

  it("says nothing when the customer cancels the share sheet", async () => {
    vi.resetModules();
    const { shareFlourish } = await import("../lib/share.js");
    const share = vi.fn().mockRejectedValue(Object.assign(new Error("x"), { name: "AbortError" }));
    await expect(shareFlourish({ share })).resolves.toBeNull();
  });
});

describe("items cooked only on certain days", () => {
  const SAT_NOON = new Date(2026, 7, 1, 12, 0);   // Saturday

  it("greys out Seafood Stew Peas midweek and says when it's back", async () => {
    const { user } = await renderApp(MON_NOON);
    const lunch = document.querySelector('section[data-cat="Lunch & Dinner"]');
    const row = within(lunch).getByRole("button", { name: /^Seafood Stew Peas/ });

    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(within(row).getByText("FRI & SAT ONLY")).toBeInTheDocument();

    await user.click(row);
    expect(await screen.findByText(/available fri & sat only/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cart, empty/i })).toBeInTheDocument();
  });

  it("sells it on a Friday", async () => {
    await renderApp(FRI_NOON);
    const lunch = document.querySelector('section[data-cat="Lunch & Dinner"]');
    const row = within(lunch).getByRole("button", { name: /^Seafood Stew Peas/ });
    expect(row).not.toHaveAttribute("aria-disabled");
    expect(within(row).queryByText(/ONLY/)).not.toBeInTheDocument();
  });

  it("sells it on a Saturday too", async () => {
    await renderApp(SAT_NOON);
    const lunch = document.querySelector('section[data-cat="Lunch & Dinner"]');
    const row = within(lunch).getByRole("button", { name: /^Seafood Stew Peas/ });
    expect(row).not.toHaveAttribute("aria-disabled");
  });

  it("leaves it out of a reorder placed on a day it isn't cooked", async () => {
    // Order it on Saturday, then reorder on Monday — it must not silently
    // reappear in the cart for a day the kitchen doesn't make it.
    const { MENU } = await import("../data/menu.data.js");
    const item = MENU.flatMap((c) => c.items).find((i) => i.id === "32VDQ4G5J131P");
    expect(item.days).toEqual([5, 6]);
  });
});

describe("seafood stew peas is one dish, not a size of another", () => {
  it("is not offered inside the Stew Peas size group on any day", async () => {
    const { MENU } = await import("../data/menu.data.js");
    const stewPeas = MENU.flatMap((c) => c.items).find((i) => i.id === "ZTAQ37M4E9S4C");
    const sizes = stewPeas.groups.find((g) => g.kind === "variant");

    const seafood = sizes.mods.find((m) => m.n === "Seafood");
    expect(seafood.oos).toBe(true);                       // hidden from customers
    expect(sizes.mods.filter((m) => !m.oos).map((m) => m.n)).toEqual(["Medium", "Large"]);
  });

  it("does not let the hidden option inflate the Stew Peas price range", async () => {
    const { MENU } = await import("../data/menu.data.js");
    const stewPeas = MENU.flatMap((c) => c.items).find((i) => i.id === "ZTAQ37M4E9S4C");
    expect([stewPeas.lo, stewPeas.hi]).toEqual([15, 18]);  // not 15–30
  });

  it("shows only Medium and Large in the item sheet", async () => {
    const { user } = await renderApp(FRI_NOON);
    const lunch = document.querySelector('section[data-cat="Lunch & Dinner"]');
    await user.click(within(lunch).getByRole("button", { name: /^Stew Peas,/ }));

    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("Medium")).toBeInTheDocument();
    expect(within(sheet).getByText("Large")).toBeInTheDocument();
    expect(within(sheet).queryByText("Seafood")).not.toBeInTheDocument();
  });

  it("sells it as its own item, one size, with no size picker", async () => {
    const { user } = await renderApp(FRI_NOON);
    const lunch = document.querySelector('section[data-cat="Lunch & Dinner"]');
    // No choices at all means it quick-adds rather than opening a sheet
    await user.click(within(lunch).getByRole("button", { name: /^Add Seafood Stew Peas to cart$/ }));

    expect(await screen.findByRole("button", { name: /cart, 1 item/i })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
