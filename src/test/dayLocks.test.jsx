import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import request from "supertest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../../server/app.js";
import { __resetRateLimit } from "../../server/guard.js";
import { __resetPrinters, __resetLoyalty, CloverError } from "../../server/clover.js";
import { MENU } from "../data/menu.data.js";
import {
  dayOfWeek, daysLabel, itemDays, modifierDays,
  isItemAvailable, isModifierAvailable,
  unavailableInCart, unavailableMessage, RESTAURANT_TZ,
} from "../lib/availability.js";
import ItemSheet from "../components/ItemSheet.jsx";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

/* ============================================================================
   DAY LOCKS, ON ITEMS AND ON MODIFIERS

   Some dishes are only cooked on certain days. So are some OPTIONS inside a
   group: soup is one Clover item whose six sizes are three different soups,
   and the kitchen makes them on different days —

     Seafood   Friday, Saturday
     Chicken   Sunday through Thursday
     Goat      every day

   Only item and category locks existed, so a modifier had to be hidden with
   `oos` — which is wrong for something genuinely on the menu four days a week:
   it vanishes, and the customer concludes the shop stopped making it.

   One mechanism, one evaluation, three places it shows up: the sheet greys the
   option with a reason, the proxy refuses the order, and both read the day in
   NEW YORK, not in whatever timezone the caller happens to be in.
   ============================================================================ */

const SOUP_GROUP = "H2749PVKFN4EY";
const SOUP_ID = "9WV3BMMSC8G5E";
const STEW_PEAS_SEAFOOD = "32VDQ4G5J131P";

const items = MENU.flatMap((c) => c.items);
const soup = items.find((i) => i.id === SOUP_ID);

/* 2026-08-31 is a Monday; the 4th a Friday, the 5th a Saturday, the 6th a Sunday. */
const MON = new Date(2026, 7, 31, 12, 0);
const FRI = new Date(2026, 8, 4, 12, 0);
const SAT = new Date(2026, 8, 5, 12, 0);
const SUN = new Date(2026, 8, 6, 12, 0);

describe("the day is the restaurant's day, not the device's", () => {
  it("reads the weekday in New York", () => {
    expect(RESTAURANT_TZ).toBe("America/New_York");
    expect(dayOfWeek(MON)).toBe(1);
    expect(dayOfWeek(FRI)).toBe(5);
    expect(dayOfWeek(SUN)).toBe(0);
  });

  it("is still Friday in New York when London has ticked over to Saturday", () => {
    /* 2026-09-05T02:00Z is 10PM Friday in New York — the kitchen is open and
       the seafood soup is on. A customer abroad, or a container running in UTC,
       would otherwise be refused food that is being cooked right then. */
    const lateFridayNY = new Date("2026-09-05T02:00:00Z");
    expect(dayOfWeek(lateFridayNY)).toBe(5);
    expect(isModifierAvailable(SOUP_GROUP, "Large Seafood", lateFridayNY)).toBe(true);
  });

  it("is already Friday in New York while UTC is still Thursday evening", () => {
    // 2026-09-04T16:00Z = noon Friday in New York.
    expect(dayOfWeek(new Date("2026-09-04T16:00:00Z"))).toBe(5);
  });

  it("has not yet turned Friday in New York at 2am UTC on Friday", () => {
    // 2026-09-04T02:00Z is 10PM Thursday in New York: chicken, not seafood.
    const stillThursday = new Date("2026-09-04T02:00:00Z");
    expect(dayOfWeek(stillThursday)).toBe(4);
    expect(isModifierAvailable(SOUP_GROUP, "Large Seafood", stillThursday)).toBe(false);
    expect(isModifierAvailable(SOUP_GROUP, "Large Chicken", stillThursday)).toBe(true);
  });
});

describe("the soup windows", () => {
  it("locks seafood to Friday and Saturday", () => {
    for (const n of ["Medium Seafood", "Large Seafood"]) {
      expect(modifierDays(SOUP_GROUP, n)).toEqual([5, 6]);
      expect(isModifierAvailable(SOUP_GROUP, n, FRI)).toBe(true);
      expect(isModifierAvailable(SOUP_GROUP, n, SAT)).toBe(true);
      expect(isModifierAvailable(SOUP_GROUP, n, MON)).toBe(false);
      expect(isModifierAvailable(SOUP_GROUP, n, SUN)).toBe(false);
    }
  });

  it("locks chicken to Sunday through Thursday", () => {
    for (const n of ["Medium Chicken", "Large Chicken"]) {
      expect(modifierDays(SOUP_GROUP, n)).toEqual([0, 1, 2, 3, 4]);
      expect(isModifierAvailable(SOUP_GROUP, n, SUN)).toBe(true);
      expect(isModifierAvailable(SOUP_GROUP, n, MON)).toBe(true);
      expect(isModifierAvailable(SOUP_GROUP, n, FRI)).toBe(false);
      expect(isModifierAvailable(SOUP_GROUP, n, SAT)).toBe(false);
    }
  });

  it("leaves goat unlocked, every day", () => {
    for (const n of ["Medium Goat", "Large Goat"]) {
      expect(modifierDays(SOUP_GROUP, n)).toBeNull();
      for (const d of [MON, FRI, SAT, SUN]) {
        expect(isModifierAvailable(SOUP_GROUP, n, d)).toBe(true);
      }
    }
  });

  it("covers every day of the week between chicken and seafood", () => {
    // No day where the only soups are goat by accident rather than by design.
    for (let d = 0; d <= 6; d++) {
      const day = new Date(2026, 8, 6 + d, 12, 0);   // Sun 6th onwards
      const open = soup.groups.find((g) => g.gid === SOUP_GROUP).mods
        .filter((m) => isModifierAvailable(SOUP_GROUP, m.n, day));
      expect(open.length, `day ${dayOfWeek(day)}`).toBe(4);   // 2 goat + 2 of the other
    }
  });
});

describe("Seafood Stew Peas is Fridays only now", () => {
  it("dropped Saturday", () => {
    expect(itemDays(STEW_PEAS_SEAFOOD)).toEqual([5]);
    expect(isItemAvailable(STEW_PEAS_SEAFOOD, FRI)).toBe(true);
    expect(isItemAvailable(STEW_PEAS_SEAFOOD, SAT)).toBe(false);
    expect(isItemAvailable(STEW_PEAS_SEAFOOD, MON)).toBe(false);
  });

  it("leaves items with no lock alone", () => {
    expect(itemDays("60KCQ1V22Q98M")).toBeNull();      // Oxtail
    for (const d of [MON, FRI, SAT, SUN]) {
      expect(isItemAvailable("60KCQ1V22Q98M", d)).toBe(true);
    }
  });
});

describe("saying when something is back", () => {
  it("reads a run of days as a range, not a chain of ampersands", () => {
    // The old label turned Sunday-to-Thursday into "Sun & Mon & Tue & Wed & Thu".
    expect(daysLabel([0, 1, 2, 3, 4])).toBe("Sun–Thu only");
    expect(daysLabel([5, 6])).toBe("Fri & Sat only");
    expect(daysLabel([5])).toBe("Fri only");
  });

  it("does not care what order the days arrive in", () => {
    expect(daysLabel([6, 5])).toBe("Fri & Sat only");
    expect(daysLabel([4, 0, 2, 1, 3])).toBe("Sun–Thu only");
  });

  it("gives a customer a reason, not just a refusal", () => {
    const entries = unavailableInCart(
      [{ itemId: SOUP_ID, name: "Soup", modifiers: [{ gid: SOUP_GROUP, name: "Large Seafood" }] }],
      MON
    );
    expect(unavailableMessage(entries)).toMatch(/Large Seafood is available Fri & Sat — not today/);
  });

  it("says nothing at all when everything is orderable", () => {
    expect(unavailableMessage(unavailableInCart([], MON))).toBeNull();
  });
});

/* ---------- the sheet ---------- */
describe("the item sheet shows a locked option rather than hiding it", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  const openSoup = () => {
    render(<ItemSheet item={soup} onClose={() => {}} onAdd={() => {}} />);
    const sheet = screen.getByRole("dialog");
    const rows = {};
    for (const row of sheet.querySelectorAll(".opt")) {
      const name = row.children[0]?.children[1]?.textContent?.trim();
      if (name) rows[name] = row;
    }
    return { sheet, rows };
  };

  it("greys seafood soup midweek and says when it is back", () => {
    vi.setSystemTime(MON);
    const { rows } = openSoup();

    // Still there — vanishing would read as "they stopped making it".
    expect(rows["Large Seafood"]).toBeTruthy();
    expect(rows["Large Seafood"]).toHaveAttribute("aria-disabled", "true");
    expect(rows["Large Seafood"].textContent).toContain("Fri & Sat only");
  });

  it("keeps it selectable on a Friday, priced not excused", () => {
    vi.setSystemTime(FRI);
    const { rows } = openSoup();
    expect(rows["Large Seafood"]).not.toHaveAttribute("aria-disabled");
    expect(rows["Large Seafood"].textContent).toContain("$15.00");
  });

  it("greys chicken soup on a Friday, the other way round", () => {
    vi.setSystemTime(FRI);
    const { rows } = openSoup();
    expect(rows["Large Chicken"]).toHaveAttribute("aria-disabled", "true");
    expect(rows["Large Chicken"].textContent).toContain("Sun–Thu only");
  });

  it("never greys goat", () => {
    for (const day of [MON, FRI, SAT, SUN]) {
      vi.setSystemTime(day);
      const { rows } = openSoup();
      expect(rows["Large Goat"], `day ${dayOfWeek(day)}`).not.toHaveAttribute("aria-disabled");
      cleanup();   // four renders in one test; unmount between them
    }
  });

  it("refuses to be selected by tap or keyboard", async () => {
    vi.setSystemTime(MON);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { rows } = openSoup();
    const locked = rows["Large Seafood"];

    await user.click(locked);
    expect(locked.className).not.toContain("sel");
    await user.type(locked, "{Enter}");
    expect(locked.className).not.toContain("sel");
  });

  it("opens on an option that can actually be ordered today", () => {
    /* The default used to skip only `oos`, so the soup sheet would open on
       seafood on a Tuesday — priced for something the proxy then refuses. */
    vi.setSystemTime(MON);
    const { sheet } = openSoup();
    const selected = sheet.querySelector(".opt.sel");
    expect(selected).toBeTruthy();
    const name = selected.children[0].children[1].textContent.trim();
    expect(isModifierAvailable(SOUP_GROUP, name, MON), `opened on ${name}`).toBe(true);
  });
});

/* ---------- the proxy, which is the enforcement that counts ---------- */
describe("the proxy refuses what the kitchen is not making today", () => {
  const CATALOG = {
    [SOUP_GROUP]: {
      "Large Seafood": { id: "M-SEA-L", price: 15 },
      "Large Chicken": { id: "M-CHK-L", price: 10 },
      "Large Goat": { id: "M-GOAT-L", price: 10 },
    },
  };
  const CUSTOMER = { name: "Kay K", phone: "3475550142" };

  const proxy = (now) => {
    const clover = {
      merchant: vi.fn().mockResolvedValue({ id: "M" }),
      createOrder: vi.fn().mockResolvedValue({ id: "CLV-9", total: 1500 }),
      getOrder: vi.fn(), printers: vi.fn().mockResolvedValue({ elements: [] }),
      printEvent: vi.fn(), items: vi.fn(), setStock: vi.fn(), charge: vi.fn(),
      fulfillOrder: vi.fn(),
      findCustomerByPhone: vi.fn().mockResolvedValue({ elements: [] }),
      createCustomer: vi.fn().mockResolvedValue({ id: "C1" }),
      attachCustomer: vi.fn().mockResolvedValue({}),
      sendOrderMessage: vi.fn().mockResolvedValue({}),
      loyaltyProgram: vi.fn().mockRejectedValue(new CloverError(405, "405", {})),
    };
    return {
      clover,
      agent: request(createApp({
        clover, catalog: async () => CATALOG, now: () => now,
        printTicket: async () => ({ printed: true, printer: null, printError: null }),
      })),
    };
  };

  const soupOrder = (agent, size) => agent.post("/api/clover/orders").send({
    cart: [{
      name: "Soup", itemId: SOUP_ID, qty: 1, price: 15,
      modifiers: [{ gid: SOUP_GROUP, name: size, price: 15 }],
    }],
    customer: CUSTOMER, orderNumber: "FL-1",
  });

  beforeEach(() => { __resetRateLimit(); __resetPrinters(); __resetLoyalty(); vi.clearAllMocks(); });

  it("refuses seafood soup on a Monday, with a reason", async () => {
    const { agent, clover } = proxy(MON);
    const r = await soupOrder(agent, "Large Seafood").expect(409);

    expect(r.body.code).toBe("NOT_AVAILABLE_TODAY");
    expect(r.body.error).toMatch(/Large Seafood is available Fri & Sat/);
    expect(r.body.unavailable[0]).toMatchObject({ kind: "modifier", days: [5, 6] });
    // Nothing reached the register.
    expect(clover.createOrder).not.toHaveBeenCalled();
  });

  it("takes the same order on a Friday", async () => {
    const { agent, clover } = proxy(FRI);
    await soupOrder(agent, "Large Seafood").expect(200);
    expect(clover.createOrder).toHaveBeenCalled();
  });

  it("refuses chicken soup on a Saturday", async () => {
    const { agent } = proxy(SAT);
    const r = await soupOrder(agent, "Large Chicken").expect(409);
    expect(r.body.error).toMatch(/Sun–Thu/);
  });

  it("takes goat soup on any day", async () => {
    for (const day of [MON, FRI, SAT, SUN]) {
      __resetRateLimit();
      const { agent } = proxy(day);
      await soupOrder(agent, "Large Goat").expect(200);
    }
  });

  it("refuses a day-locked ITEM through the same path", async () => {
    /* One enforcement path, not two: the item lock and the modifier lock are
       checked in the same pass and answer with the same code. */
    const { agent, clover } = proxy(MON);
    const r = await agent.post("/api/clover/orders").send({
      cart: [{ name: "Seafood Stew Peas", itemId: STEW_PEAS_SEAFOOD, qty: 1, price: 30, modifiers: [] }],
      customer: CUSTOMER, orderNumber: "FL-2",
    }).expect(409);

    expect(r.body.code).toBe("NOT_AVAILABLE_TODAY");
    expect(r.body.unavailable[0]).toMatchObject({ kind: "item", days: [5] });
    expect(clover.createOrder).not.toHaveBeenCalled();
  });

  it("refuses it on a Saturday too, now the window is Friday only", async () => {
    const { agent } = proxy(SAT);
    await agent.post("/api/clover/orders").send({
      cart: [{ name: "Seafood Stew Peas", itemId: STEW_PEAS_SEAFOOD, qty: 1, price: 30, modifiers: [] }],
      customer: CUSTOMER, orderNumber: "FL-3",
    }).expect(409);
  });

  it("reports everything unavailable at once, not just the first", async () => {
    const { agent } = proxy(MON);
    const r = await agent.post("/api/clover/orders").send({
      cart: [
        { name: "Seafood Stew Peas", itemId: STEW_PEAS_SEAFOOD, qty: 1, price: 30, modifiers: [] },
        { name: "Soup", itemId: SOUP_ID, qty: 1, price: 15,
          modifiers: [{ gid: SOUP_GROUP, name: "Large Seafood", price: 15 }] },
      ],
      customer: CUSTOMER, orderNumber: "FL-4",
    }).expect(409);

    expect(r.body.unavailable).toHaveLength(2);
    expect(r.body.error).toMatch(/2 things/);
  });
});

/* ---------- the declaration and the data cannot drift ---------- */
describe("the locks in the data match the generator", () => {
  const gen = readFileSync(resolve(ROOT, "scripts/generate-menu.mjs"), "utf8");
  const slice = (start, end) => { const a = gen.indexOf(start); return gen.slice(a, gen.indexOf(end, a)); };
  const parse = (block) => Object.fromEntries(
    [...block.matchAll(/"([^"]+)":\s*(\[[\d, ]*\])/g)].map((m) => [m[1], JSON.parse(m[2])])
  );

  it("applies every declared modifier lock", () => {
    const declared = parse(slice("const MODIFIER_DAYS = {", "};"));
    expect(Object.keys(declared).length).toBeGreaterThan(0);
    for (const [key, days] of Object.entries(declared)) {
      expect(modifierDays(...key.split("::")), key).toEqual(days);
    }
  });

  it("applies every declared item lock", () => {
    for (const [id, days] of Object.entries(parse(slice("const ITEM_DAYS = {", "};")))) {
      expect(itemDays(id), id).toEqual(days);
    }
  });

  it("locks nothing the generator did not declare", () => {
    /* A day lock that appeared in the data without a declaration would be
       unexplainable and would vanish on the next regeneration. */
    const declaredMods = parse(slice("const MODIFIER_DAYS = {", "};"));
    for (const cat of MENU) {
      for (const item of cat.items) {
        for (const g of item.groups ?? []) {
          for (const m of g.mods ?? []) {
            if (m.days) expect(declaredMods[`${g.gid}::${m.n}`], `${g.gid}::${m.n}`).toEqual(m.days);
          }
        }
      }
    }
  });

  it("emits the lock from the generator's own template", () => {
    // Otherwise the next regeneration drops every modifier lock on the floor.
    expect(gen).toMatch(/m\.days \? `, days: \$\{JSON\.stringify\(m\.days\)\}`/);
    expect(gen).toMatch(/if \(MODIFIER_DAYS\[key\]\) m\.days = MODIFIER_DAYS\[key\]/);
  });

  it("warns about a lock on a modifier that no longer exists", () => {
    // A silent no-op would leave the option orderable every day.
    expect(gen).toContain("which is not a modifier on the menu");
  });
});
