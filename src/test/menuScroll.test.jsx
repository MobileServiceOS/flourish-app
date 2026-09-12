import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { stubOnlineProxy } from "./helpers.js";
import { MENU } from "../data/menu.data.js";

/* A section that is not the first one, taken from the data rather than named.
   These tests used to scroll to "Drinks", which stopped existing when the
   register dropped the category. */
const LATER_CAT = MENU.at(-1).cat;
const LATER_RE = new RegExp(LATER_CAT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

const MON_NOON = new Date(2026, 6, 27, 12, 0);

/* The stubbed IntersectionObserver in setup.js swallows its callback, which is
   exactly what the scroll-spy runs on. This one hands it back, so a test can
   scroll the menu the way a thumb does and see what the app does about it. */
function captureObservers() {
  const observers = [];
  vi.stubGlobal("IntersectionObserver", class {
    constructor(cb) { this.cb = cb; this.targets = []; observers.push(this); }
    observe(el) { this.targets.push(el); }
    unobserve() {}
    disconnect() { this.targets = []; }
    /** Pretend the named section has come under the nav. */
    scrollTo(cat) {
      this.cb(this.targets.map((t) => ({
        target: t,
        isIntersecting: t.dataset.cat === cat,
      })), this);
    }
  });
  return observers;
}

async function renderApp() {
  vi.setSystemTime(MON_NOON);
  vi.resetModules();
  stubOnlineProxy({ vi });
  const { default: App } = await import("../App.jsx");
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<App />);
  await screen.findByRole("button", { name: /staff/i });
  return { user };
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

/* ============================================================================
   THE STANDALONE SIDE

   "Side" (6NX7XK602V0ZM) is a real item — 21 options from $1 to $15 — and it
   was rendering all along. What made it look missing was the search: it matched
   on descriptions too, and seven plates say "with two sides", so the item
   itself came back EIGHTH. Anyone scanning the results concluded it wasn't
   there.
   ============================================================================ */
describe("the standalone Side item", () => {
  it("has a row in Lunch & Dinner like every other item", async () => {
    await renderApp();
    const lunch = document.querySelector('section[data-cat="Lunch & Dinner"]');
    const row = within(lunch).getByRole("button", { name: /^Side, One side on its own/ });
    expect(row).toBeInTheDocument();
  });

  it("shows its emoji and its full price range", async () => {
    await renderApp();
    const lunch = document.querySelector('section[data-cat="Lunch & Dinner"]');
    const row = within(lunch).getByRole("button", { name: /^Side, One side on its own/ });

    expect(within(row).getByRole("img", { name: "Side" })).toHaveTextContent("🍚");
    // $1 cheapest option to $15 dearest — a range, not a single price.
    expect(row.querySelector(".price").textContent.replace(/\s+/g, " "))
      .toContain("$1.00 – $15.00");
  });

  it("opens its options sheet with all 21 choices", async () => {
    const { user } = await renderApp();
    const lunch = document.querySelector('section[data-cat="Lunch & Dinner"]');
    await user.click(within(lunch).getByRole("button", { name: /^Choose options for Side$/ }));

    const sheet = await screen.findByRole("dialog");
    // The 21 options, priced individually — $1 Festival up to $15 Pepper Shrimp.
    expect(within(sheet).getByText("Mac & Cheese")).toBeInTheDocument();
    expect(within(sheet).getByText("Rice & Peas")).toBeInTheDocument();
    expect(within(sheet).getByText("Pepper Shrimp")).toBeInTheDocument();
  });

  it("is the FIRST result when you search for it, not buried under the plates", async () => {
    const { user } = await renderApp();
    await user.type(screen.getByLabelText("Search menu"), "Side");

    const labels = [...document.querySelectorAll(".item")].map((e) => e.getAttribute("aria-label"));
    expect(labels[0]).toMatch(/^Side, One side on its own/);
    // The description matches still come back — they are just ranked below it.
    expect(labels.length).toBeGreaterThan(1);
    expect(labels.slice(1).join(" ")).toMatch(/with two sides/);
  });

  it("ranks an exact name match first for other items too", async () => {
    const { user } = await renderApp();
    await user.type(screen.getByLabelText("Search menu"), "Oxtail");
    const labels = [...document.querySelectorAll(".item")].map((e) => e.getAttribute("aria-label"));
    expect(labels[0]).toMatch(/^Oxtail,/);
  });
});

/* ============================================================================
   SCROLLING

   The menu snapped back to the top on iOS. The scroll-spy is not what moved it:
   MenuView kept the highlighted chip on screen with
   `chip.scrollIntoView({ block: "nearest", inline: "center" })`, and
   scrollIntoView scrolls EVERY scrollable ancestor — including the document.
   The chip strip is `position: sticky`, so WebKit resolved the block position
   against the sticky offset and dragged the page with it, on every one of the
   many activeCat changes a single flick produces.

   The rule these tests hold: the spy may move the chip strip. It may never move
   the content.
   ============================================================================ */
describe("scrolling the menu never moves the content", () => {
  it("does not call scrollIntoView when the spy changes the active section", async () => {
    const observers = captureObservers();
    await renderApp();

    const spy = vi.spyOn(Element.prototype, "scrollIntoView");
    const io = observers.at(-1);
    expect(io).toBeTruthy();

    // A thumb-flick down the page: several sections pass under the nav.
    io.scrollTo("Lunch & Dinner");
    io.scrollTo("Seafood Fridays");
    io.scrollTo(LATER_CAT);

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("still moves the highlight as sections pass under the nav", async () => {
    const observers = captureObservers();
    await renderApp();
    const io = observers.at(-1);

    io.scrollTo(LATER_CAT);
    const chip = await screen.findByRole("tab", { name: LATER_RE });
    expect(chip).toHaveAttribute("aria-selected", "true");
  });

  it("scrolls only the chip strip's own scrollLeft, with no vertical component", async () => {
    const observers = captureObservers();
    await renderApp();

    const nav = document.querySelector(".cat-nav");
    /* jsdom gives every box zero size, so the centring maths would no-op. Fake
       just enough layout to exercise it: a 300px strip scrolled 900px wide,
       with the target chip 100px wide sitting at 500px. */
    const fake = (el, props) => {
      for (const [k, v] of Object.entries(props)) {
        Object.defineProperty(el, k, { value: v, configurable: true });
      }
    };
    fake(nav, { clientWidth: 300, scrollWidth: 900 });
    nav.scrollTo = vi.fn();
    const anyScroll = vi.spyOn(Element.prototype, "scrollIntoView");

    const chip = screen.getByRole("tab", { name: LATER_RE });
    fake(chip, { offsetLeft: 500, offsetWidth: 100 });

    observers.at(-1).scrollTo(LATER_CAT);

    // Centred: 500 - (300 - 100) / 2 = 400.
    await waitFor(() =>
      expect(nav.scrollTo).toHaveBeenCalledWith({ left: 400, behavior: "smooth" })
    );
    // No `top`, so this call cannot move the page even by accident.
    expect(nav.scrollTo.mock.calls[0][0]).not.toHaveProperty("top");
    expect(anyScroll).not.toHaveBeenCalled();
    anyScroll.mockRestore();
  });

  it("still jumps to a section when the customer taps its chip", async () => {
    // The one programmatic content scroll that is allowed, because a tap asked
    // for it. Removing this would break the chips.
    const { user } = await renderApp();
    const spy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});

    await user.click(screen.getByRole("tab", { name: LATER_RE }));

    expect(spy).toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: LATER_RE })).toHaveAttribute("aria-selected", "true");
    spy.mockRestore();
  });

  it("does not move the content when a search re-picks the active category", async () => {
    /* Typing narrows the menu, which can leave activeCat pointing at a section
       that no longer exists — App re-picks the first one. That must not scroll
       the page either, or the list jumps under the thumb mid-search. */
    captureObservers();
    const { user } = await renderApp();
    const spy = vi.spyOn(Element.prototype, "scrollIntoView");

    await user.type(screen.getByLabelText("Search menu"), "Drink");

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

/* ============================================================================
   SEARCHING BY FLAVOUR, THROUGH THE ACTUAL UI

   The unit tests cover the matching; these two cover the thing a customer
   experiences — typing a dish name and getting the dish, already set to what
   they asked for.
   ============================================================================ */
describe("searching for a flavour", () => {
  it("finds Salmon from a flavour that is not in any item name", async () => {
    const { user } = await renderApp();
    await user.type(screen.getByLabelText("Search menu"), "sweet chili salmon");

    const labels = [...document.querySelectorAll(".item")].map((e) => e.getAttribute("aria-label"));
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatch(/^Salmon,/);
  });

  it("opens the sheet already set to the flavour that was searched for", async () => {
    /* Honey Garlic on purpose: it is NOT the default (Sweet Chili is), so this
       fails if preselection is not happening rather than passing by accident.
       Finding the dish and then landing on the wrong flavour would be worse
       than not matching at all. */
    const { user } = await renderApp();
    await user.type(screen.getByLabelText("Search menu"), "honey garlic salmon");
    await user.click(await screen.findByRole("button", { name: /^Choose options for Salmon$/ }));

    // Option marks the chosen row with a `sel` class.
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("button", { name: /Honey Garlic/ }).className).toContain("sel");
    expect(within(sheet).getByRole("button", { name: /Sweet Chili/ }).className).not.toContain("sel");
  });

  it("still defaults to the cheapest option with no search behind it", async () => {
    const { user } = await renderApp();
    const lunch = document.querySelector('section[data-cat="Lunch & Dinner"]');
    await user.click(within(lunch).getByRole("button", { name: /^Choose options for Salmon$/ }));

    // Sweet Chili is also the first sellable option, so it is the default too.
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("button", { name: /Sweet Chili/ }).className)
      .toContain("sel");
  });
});
