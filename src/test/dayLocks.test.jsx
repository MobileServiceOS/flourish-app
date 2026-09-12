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
import { MENU, PLATE_IDS, hasChoices } from "../data/menu.data.js";
import { sizePrices } from "../lib/restaurant.js";
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

  it("covers every day of the week between chicken and seafood", () => {
    /* Chicken Sun-Thu and seafood Fri-Sat between them cover all seven days.
       Goat used to be the unlocked third soup padding this out; it has been
       deleted at the register, so the two locked pairs are now the whole group
       and the property they have to satisfy is the same one that matters —
       never a day where the row can be tapped and nothing inside it can be
       ordered. */
    for (let d = 0; d <= 6; d++) {
      const day = new Date(2026, 8, 6 + d, 12, 0);   // Sun 6th onwards
      const open = soup.groups.find((g) => g.gid === SOUP_GROUP).mods
        .filter((m) => isModifierAvailable(SOUP_GROUP, m.n, day));
      expect(open.length, `day ${dayOfWeek(day)}`).toBe(2);   // one size pair, every day
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

describe("Seafood Stew Peas is large only, and says so", () => {
  /* A flat $30 dish with no size group in Clover. These assert the absence of a
     SIZE choice specifically, not the absence of groups — `Side With Meal` is
     queued to be attached at the register, and when it is this item gains a
     sides picker and should still have no sizes. */
  const dish = items.find((i) => i.id === STEW_PEAS_SEAFOOD);

  it("carries no size or flavour group", () => {
    const choosable = (dish.groups ?? []).filter((g) => g.kind === "variant" || g.kind === "flavor");
    expect(choosable).toEqual([]);
  });

  it("shows one price, never a range", () => {
    // A range is what renders as "$20.00 – $30.00" and implies a choice.
    expect(dish.lo).toBe(dish.hi);
    expect(dish.lo).toBe(30);
    expect(sizePrices(dish), "a Med/Lg row would imply two sizes").toBeNull();
  });

  it("says large in its own copy", () => {
    expect(dish.desc).toMatch(/one size, large/i);
  });

  it("offers no size words to search", () => {
    // "medium stew peas" must not reach it through the index.
    expect(dish.search).not.toMatch(/medium|large|small/i);
  });

  it("opens a chooser now, because it has sides to choose", () => {
    /* This asserted one-tap, which was right while the item had no modifier
       groups at all. `Side With Meal` has since been attached at the register —
       which the note in CLAUDE.md anticipated: "when it is, this item gains a
       sides picker and should still have no sizes". Both halves matter, and the
       size half is asserted separately above and below. */
    expect(hasChoices(dish)).toBe(true);
    expect(dish.groups.map((g) => g.name)).toEqual(["Side With Meal"]);
  });

  it("is a plate now, and its copy has to keep up", () => {
    /* PLATE_IDS is derived from having a side group, so this flipped with the
       register change rather than with anything in the app. It is what the
       free-plate reward keys on, so it is worth asserting rather than
       inferring. */
    expect(PLATE_IDS.has(dish.id)).toBe(true);
  });

  it("still offers no SIZE, which is the thing that was never true", () => {
    // The whole point of this block: one size, large, whatever else it gains.
    const sizeish = dish.groups.filter((g) => /size|stew peas/i.test(g.name));
    expect(sizeish).toEqual([]);
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

  /* There was a "never greys goat" test here. Goat is not rendered at all now —
     it is hidden from the app entirely — so the assertion moved to
     "goat soup is hidden from the app", which checks it is absent rather than
     present-and-ungreyed. That goat carries no DAY lock is still covered by
     "leaves goat unlocked, every day": it is hidden for a different reason. */

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

/* ============================================================================
   HIDDEN IN THE APP, STILL SOLD AT THE COUNTER

   Goat soup is sold in person but not orderable here. It also rings $0 at the
   register — which is the owner's to fix in the Clover dashboard, and the app
   deliberately does NOT paper over it with a price override any more. Hiding it
   is the whole of the app's involvement.
   ============================================================================ */
describe("goat soup is gone from the register, not hidden here", () => {
  const soupMods = soup.groups.find((g) => g.gid === SOUP_GROUP).mods;

  it("carries no goat size at all", () => {
    /* The two goat sizes were hidden in the app while they still existed in
       Clover. They have since been DELETED from the Soup group at the
       register, so there is nothing left to hide — and the generator now warns
       about any HIDDEN_IN_APP key naming a modifier the export does not carry,
       which is how the dangling entries were caught. */
    expect(soupMods.filter((m) => /goat/i.test(m.n))).toHaveLength(0);
  });

  it("leaves exactly the four chicken and seafood sizes", () => {
    expect(soupMods.map((m) => m.n).sort()).toEqual(
      ["Large Chicken", "Large Seafood", "Medium Chicken", "Medium Seafood"]
    );
  });

  it("never reaches the sheet at all", () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(MON);
    render(<ItemSheet item={soup} onClose={() => {}} onAdd={() => {}} />);
    const sheet = screen.getByRole("dialog");
    expect(sheet.textContent).not.toMatch(/goat/i);
    cleanup();
    vi.useRealTimers();
  });

  it("is not findable by searching for it", () => {
    expect(soup.search).not.toMatch(/goat/);
    expect(soup.search).toBe("soup medium chicken large seafood");
  });

  it("still leaves Curried Goat findable — a different item", () => {
    const curried = items.find((i) => /curried goat/i.test(i.name));
    expect(curried).toBeTruthy();
    expect(curried.search).toMatch(/goat/);
  });

  it("does not change the price range the row advertises", () => {
    // $5 chicken to $15 seafood, unaffected by hiding the $0 sizes.
    expect([soup.lo, soup.hi]).toEqual([5, 15]);
  });
});

describe("no item can become a dead row", () => {
  /* Hiding options and locking others by day could between them leave an item
     that renders a tappable row with nothing selectable behind it. Chicken
     (Sun–Thu) and seafood (Fri–Sat) happen to cover all seven days, and this is
     what keeps it that way. */
  it("leaves something selectable in every single-select group, every day", () => {
    for (const cat of MENU) {
      for (const item of cat.items) {
        for (const g of item.groups ?? []) {
          if (g.kind === "side") continue;
          const sellable = g.mods.filter((m) => !m.oos);
          if (!sellable.length) continue;
          for (let day = 0; day <= 6; day++) {
            const open = sellable.filter((m) => !m.days || m.days.includes(day));
            expect(open.length,
              `${item.name} / ${g.name} has nothing selectable on day ${day}`)
              .toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("is guarded in the generator too, so a regeneration reports it", () => {
    const gen = readFileSync(resolve(ROOT, "scripts/generate-menu.mjs"), "utf8");
    expect(gen).toContain("the row would be a dead end");
    expect(gen).toContain("Give the item an ITEM_DAYS lock");
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

  it("hides exactly what HIDDEN_IN_APP declares, and nothing more", () => {
    /* The map is empty today: its only two entries were the goat soup sizes,
       and those were deleted at the register rather than hidden. An empty map
       is a legitimate state, so this no longer asserts the map has entries —
       that assertion existed to prove the slice parser found something, and it
       would now fail for the one reason that is not a bug.

       What is still worth checking is the direction that can actually go
       wrong: anything named here must exist and be marked oos. The reverse
       direction — an oos modifier nobody declared — is covered by
       "every oos modifier has a stated reason" below. */
    const declared = new Set(
      [...slice("const HIDDEN_IN_APP = {", "};").matchAll(/"([^"]+)":/g)].map((m) => m[1])
    );
    for (const key of declared) {
      const [gid, name] = key.split("::");
      const mod = MENU.flatMap((c) => c.items)
        .flatMap((i) => i.groups ?? [])
        .filter((g) => g.gid === gid)
        .flatMap((g) => g.mods)
        .find((m) => m.n === name);
      expect(mod, key).toBeTruthy();
      expect(mod.oos, key).toBe(true);
    }
  });

  it("every oos modifier has a stated reason in one of the three maps", () => {
    /* The point of keeping three separate maps is that the REASON survives.
       An oos flag with no entry anywhere is the thing the hide-reasons audit
       found 8 of, and this is what stops a ninth appearing. */
    const declared = new Set([
      ...[...slice("const HIDDEN_IN_APP = {", "};").matchAll(/"([^"]+)":/g)].map((m) => m[1]),
      ...[...slice("const MISFILED_AS_SIZE = {", "};").matchAll(/"([^"]+)":/g)].map((m) => m[1]),
      ...[...slice("const NOT_ON_PRINTED_MENU = new Set([", "]);").matchAll(/"([^"]+)"/g)].map((m) => m[1]),
    ]);
    /* Two rules in the generator hide a modifier without naming it in a map,
       and both state their reason in the run's issue list instead: an option
       priced $0 inside a size group (it would ring the plate up free), and an
       option named after its own item sitting in that item's size group (it
       reads to a customer as a size — the Wings case). Those are derived from
       the data rather than decided by a human, which is why they are not
       declarations. Anything else with an oos flag is an undocumented hide. */
    const selfNamed = (item, mod) => mod.trim().toLowerCase() === item.trim().toLowerCase();

    const undeclared = MENU.flatMap((c) => c.items)
      .flatMap((i) => (i.groups ?? []).flatMap((g) =>
        g.mods.map((m) => ({ key: `${g.gid}::${m.n}`, oos: m.oos, auto: m.p === 0 || selfNamed(i.name, m.n) }))
      ))
      .filter((m) => m.oos && !m.auto && !declared.has(m.key))
      .map((m) => m.key);
    expect([...new Set(undeclared)]).toEqual([]);
  });

  it("no longer overrides the goat prices it used to paper over", () => {
    const gen2 = readFileSync(resolve(ROOT, "scripts/generate-menu.mjs"), "utf8");
    expect(gen2).not.toMatch(/"H2749PVKFN4EY::(Medium|Large) Goat":\s*[\d.]+/);
  });

  it("warns about a lock on a modifier that no longer exists", () => {
    // A silent no-op would leave the option orderable every day.
    expect(gen).toContain("which is not a modifier on the menu");
  });
});
