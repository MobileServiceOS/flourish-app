import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MENU, POPULAR_IDS } from "../data/menu.data.js";
import { addItem } from "./helpers.js";

/* App reads the day of the week at module scope to decide the default category,
   so the clock has to be set before the module is imported. */
async function renderApp(when = new Date(2026, 6, 27, 12, 0)) { // Monday noon
  vi.setSystemTime(when);
  vi.resetModules();
  const { default: App } = await import("../App.jsx");
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<App />);
  // let the account-loading splash resolve
  await screen.findByRole("button", { name: /staff/i });
  return { user };
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe("menu data", () => {
  it("gives every item a one-line description", () => {
    const items = MENU.flatMap((c) => c.items);
    const missing = items.filter((i) => !i.desc || !i.desc.trim());
    expect(missing.map((i) => i.name)).toEqual([]);
  });

  it("keeps descriptions to a single line", () => {
    for (const it of MENU.flatMap((c) => c.items)) {
      expect(it.desc).not.toMatch(/\n/);
      expect(it.desc.length).toBeLessThanOrEqual(60);
    }
  });

  it("has the six known-for items on the menu", () => {
    const ids = new Set(MENU.flatMap((c) => c.items).map((i) => i.id));
    for (const id of POPULAR_IDS) expect(ids.has(id)).toBe(true);
  });
});

describe("menu view", () => {
  it("shows each item's description under its name", async () => {
    await renderApp();
    // Oxtail's copy, from the brief
    expect(screen.getAllByText("Slow-cooked, fall-off-the-bone tender").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Made to order. Pick your sauce.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Tender island-style curry goat").length).toBeGreaterThan(0);
  });

  it("puts Popular first, before Lunch & Dinner", async () => {
    await renderApp();
    const chips = screen.getAllByRole("tab").map((b) => b.textContent);
    expect(chips[0]).toBe("Popular");
    expect(chips[1]).toBe("Lunch & Dinner");
  });

  it("shows exactly the six known-for items in Popular", async () => {
    await renderApp();
    const section = document.querySelector('section[data-cat="Popular"]');
    // item rows carry a price in their label; the + buttons do not
    const rows = within(section).getAllByRole("button", { name: /\$\d/ });
    expect(rows).toHaveLength(6);
    expect(section.textContent).toContain("Oxtail");
    expect(section.textContent).toContain("Jerk Chicken");
    expect(section.textContent).toContain("Wings");
  });

  it("labels Seafood Fridays with (Fri) when it is not Friday", async () => {
    await renderApp(new Date(2026, 6, 27, 12, 0)); // Monday
    const chips = screen.getAllByRole("tab").map((b) => b.textContent);
    expect(chips).toContain("Seafood Fridays (Fri)");
  });

  it("selects a chip when tapped", async () => {
    const { user } = await renderApp();
    const drinks = screen.getByRole("tab", { name: "Drinks" });
    await user.click(drinks);
    expect(drinks).toHaveAttribute("aria-selected", "true");
  });
});

describe("adding to the cart", () => {
  it("shows a count badge on the cart tab once something is in it", async () => {
    const { user } = await renderApp();
    expect(screen.getByRole("button", { name: /cart, empty/i })).toBeInTheDocument();

    await addItem(user);

    const cartTab = await screen.findByRole("button", { name: /cart, 1 item/i });
    expect(within(cartTab).getByText("1")).toBeInTheDocument();
  });

  it("counts quantity, not lines", async () => {
    const { user } = await renderApp();
    await addItem(user);
    await addItem(user);
    expect(await screen.findByRole("button", { name: /cart, 2 items/i })).toBeInTheDocument();
  });

  it("pops the + button as a confirmation on quick-add", async () => {
    // Since the printed-menu cull the only one-tap items are the Friday
    // platters — everything sold on a weekday has sides to choose.
    const { user } = await renderApp(new Date(2026, 6, 31, 12, 0)); // Friday
    const add = screen.getByRole("button", { name: "Add Fish Platter (Shrimp & 2 Sides) to cart" });
    await user.click(add);
    await vi.waitFor(() => expect(add.className).toContain("pop"));
    expect(await screen.findByRole("button", { name: /cart, 1 item/i })).toBeInTheDocument();
  });

  it("opens the options sheet instead of quick-adding when the item has choices", async () => {
    const { user } = await renderApp();
    // Oxtail is deliberately in two sections (Popular reuses the object), so scope it
    const lunch = document.querySelector('section[data-cat="Lunch & Dinner"]');
    await user.click(within(lunch).getByRole("button", { name: /^Choose options for Oxtail$/ }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    // nothing added yet
    expect(screen.getByRole("button", { name: /cart, empty/i })).toBeInTheDocument();
  });
});

describe("search", () => {
  it("offers a way out when nothing matches", async () => {
    const { user } = await renderApp();
    await user.type(screen.getByLabelText("Search menu"), "zzzzz");
    const empty = await screen.findByText("No items match");
    expect(empty).toBeInTheDocument();

    // the CTA inside the empty state, not the X in the search field
    await user.click(within(empty.closest("div").parentElement)
      .getByRole("button", { name: "Clear search" }));
    expect(screen.queryByText("No items match")).not.toBeInTheDocument();
  });
});

describe("a price range that is really two sizes says so", () => {
  it("labels Medium and Large instead of printing a bare range", async () => {
    await renderApp();
    const lunch = document.querySelector('section[data-cat="Lunch & Dinner"]');
    const oxtail = within(lunch).getByRole("button", { name: /^Oxtail,/ });

    expect(oxtail).toHaveAccessibleName(/medium \$20\.00, large \$25\.00/i);
    expect(oxtail.textContent).toContain("Med");
    expect(oxtail.textContent).toContain("$20.00");
    expect(oxtail.textContent).toContain("Lg");
    expect(oxtail.textContent).toContain("$25.00");
  });

  it("leaves a genuine range alone when the options are dishes, not sizes", async () => {
    await renderApp();
    const lunch = document.querySelector('section[data-cat="Lunch & Dinner"]');
    // Pork is Medium/Large Stew and Medium/Large Jerk — four options, not two sizes
    const pork = within(lunch).getByRole("button", { name: /^Pork,/ });
    expect(pork).toHaveAccessibleName(/\$20\.00 to \$25\.00/);   // printed-menu prices
    expect(pork.textContent).not.toContain("Med ");
  });

  it("never invents a price — both figures come from the Clover group", async () => {
    const { MENU } = await import("../data/menu.data.js");
    const { sizePrices } = await import("../lib/restaurant.js");
    for (const it of MENU.flatMap((c) => c.items)) {
      const s = sizePrices(it);
      if (!s) continue;
      const mods = it.groups.find((g) => g.kind === "variant").mods.filter((m) => !m.oos);
      expect(s.med).toBe(mods[0].p);
      expect(s.lg).toBe(mods[1].p);
      expect([it.lo, it.hi]).toEqual([s.med, s.lg]);
    }
  });

  it("says nothing about sizes for a single-price item", async () => {
    const { MENU } = await import("../data/menu.data.js");
    const { sizePrices } = await import("../lib/restaurant.js");
    const lamb = MENU.flatMap((c) => c.items).find((i) => i.name === "Lamb");
    expect(sizePrices(lamb)).toBeNull();
  });
});

describe("delisted items", () => {
  it("no longer offers Baked Chicken", async () => {
    const { MENU } = await import("../data/menu.data.js");
    const all = MENU.flatMap((c) => c.items);
    expect(all.find((i) => i.id === "NH99VMKKGJ572")).toBeUndefined();
    expect(all.some((i) => /baked chicken/i.test(i.name))).toBe(false);
  });
});
