import { describe, it, expect } from "vitest";
import {
  buildAtomicOrder, buildPayment, resolveModifiers, trackingStage,
  toCents, ModifierResolutionError,
} from "../lib/cloverOrder.js";

/* A slice of what Clover returns from /modifier_groups?expand=modifiers,
   reshaped the way server/clover.js caches it. */
const CATALOG = {
  "45KGD3ZDMT2ZY": {                       // Oxtail Size
    "Medium": { id: "MOD-OX-MED", price: 20 },
    "Large":  { id: "MOD-OX-LRG", price: 25 },
  },
  "YQWN3PKBKV9NG": {                       // Side With Meal
    "White Rice":     { id: "MOD-SIDE-RICE", price: 0 },
    "Mac And Cheese": { id: "MOD-SIDE-MAC",  price: 0 },
    "Seafood Mac":    { id: "MOD-SIDE-SFM",  price: 3.5 },
  },
};

const oxtail = (over = {}) => ({
  name: "Oxtail",
  itemId: "60KCQ1V22Q98M",
  qty: 1,
  price: 20,
  plate: true,
  modifiers: [
    { gid: "45KGD3ZDMT2ZY", name: "Medium", price: 20 },
    { gid: "YQWN3PKBKV9NG", name: "White Rice", price: 0 },
    { gid: "YQWN3PKBKV9NG", name: "Mac And Cheese", price: 0 },
  ],
  ...over,
});

describe("money conversion", () => {
  it("converts dollars to integer cents", () => {
    expect(toCents(20)).toBe(2000);
    expect(toCents(15.99)).toBe(1599);
    expect(toCents(3.5)).toBe(350);
    expect(toCents(0)).toBe(0);
  });

  it("rounds the half-cent up rather than truncating", () => {
    // 20 * 0.08875 = 1.775 — plain truncation loses a penny against the register
    expect(toCents(1.775)).toBe(178);
    expect(toCents(6.99)).toBe(699);
    expect(toCents(0.1 + 0.2)).toBe(30);   // float noise must not become 29
  });
});

describe("modifier mapping", () => {
  it("maps app modifiers onto Clover modifier ids", () => {
    const mods = resolveModifiers(oxtail().modifiers, CATALOG);
    expect(mods).toEqual([
      { modifier: { id: "MOD-OX-MED" },   name: "Medium",         amount: 2000 },
      { modifier: { id: "MOD-SIDE-RICE" },name: "White Rice",     amount: 0 },
      { modifier: { id: "MOD-SIDE-MAC" }, name: "Mac And Cheese", amount: 0 },
    ]);
  });

  it("matches names despite Clover's inconsistent capitalisation and spacing", () => {
    const mods = resolveModifiers(
      [{ gid: "YQWN3PKBKV9NG", name: "  mac  and   cheese ", price: 0 }], CATALOG
    );
    expect(mods[0].modifier.id).toBe("MOD-SIDE-MAC");
  });

  it("carries a side upcharge through as cents", () => {
    const mods = resolveModifiers(
      [{ gid: "YQWN3PKBKV9NG", name: "Seafood Mac", price: 3.5 }], CATALOG
    );
    expect(mods[0].amount).toBe(350);
  });

  it("REFUSES the order when a modifier cannot be resolved", () => {
    // This is the important one. Oxtail is base $0 with the price in the size
    // modifier, so dropping an unresolved modifier would ring up a free plate.
    const bad = [{ gid: "45KGD3ZDMT2ZY", name: "Extra Large", price: 30 }];
    expect(() => resolveModifiers(bad, CATALOG)).toThrow(ModifierResolutionError);
    try { resolveModifiers(bad, CATALOG); } catch (e) {
      expect(e.unresolved).toEqual([{ gid: "45KGD3ZDMT2ZY", name: "Extra Large" }]);
    }
  });

  it("refuses when the whole modifier group is missing from the catalog", () => {
    expect(() => resolveModifiers(
      [{ gid: "GROUP-THAT-WENT-AWAY", name: "Medium", price: 20 }], CATALOG
    )).toThrow(ModifierResolutionError);
  });
});

describe("atomic order payload", () => {
  it("builds one line item per Clover item with its modifications", () => {
    const body = buildAtomicOrder({ cart: [oxtail()], catalog: CATALOG });
    expect(body.orderCart.lineItems).toHaveLength(1);
    const li = body.orderCart.lineItems[0];
    expect(li.item).toEqual({ id: "60KCQ1V22Q98M" });
    expect(li.modifications).toHaveLength(3);
  });

  it("expands quantity into separate line items for the kitchen ticket", () => {
    const body = buildAtomicOrder({ cart: [oxtail({ qty: 3 })], catalog: CATALOG });
    expect(body.orderCart.lineItems).toHaveLength(3);
    for (const li of body.orderCart.lineItems) {
      expect(li.item.id).toBe("60KCQ1V22Q98M");
    }
  });

  it("carries special instructions onto the line item", () => {
    const body = buildAtomicOrder({
      cart: [oxtail({ note: "no pepper, extra gravy" })], catalog: CATALOG,
    });
    expect(body.orderCart.lineItems[0].note).toBe("no pepper, extra gravy");
  });

  it("puts the pickup time on the order so the kitchen can see it", () => {
    const body = buildAtomicOrder({ cart: [oxtail()], pickupLabel: "7:30 PM", catalog: CATALOG });
    expect(body.orderCart.title).toContain("7:30 PM");
    expect(body.orderCart.note).toContain("7:30 PM");
  });

  it("attaches the Clover customer when we have one", () => {
    const body = buildAtomicOrder({ cart: [oxtail()], customerId: "CUST-1", catalog: CATALOG });
    expect(body.orderCart.customers).toEqual([{ id: "CUST-1" }]);
  });

  it("omits the customer block entirely for a guest", () => {
    const body = buildAtomicOrder({ cart: [oxtail()], catalog: CATALOG });
    expect(body.orderCart.customers).toBeUndefined();
  });

  it("refuses an empty cart", () => {
    expect(() => buildAtomicOrder({ cart: [], catalog: CATALOG })).toThrow(/empty/i);
  });

  it("refuses a line with no Clover item id", () => {
    expect(() => buildAtomicOrder({
      cart: [oxtail({ itemId: undefined })], catalog: CATALOG,
    })).toThrow(/no Clover item id/);
  });
});

describe("rewards become order discounts", () => {
  it("adds a negative discount naming the reward and its code", () => {
    const body = buildAtomicOrder({
      cart: [oxtail()],
      reward: { name: "Free side", code: "FL1234", amount: 6 },
      catalog: CATALOG,
    });
    expect(body.orderCart.discounts).toEqual([{ name: "Free side (FL1234)", amount: -600 }]);
  });

  it("keeps the discount negative even if handed a negative amount", () => {
    const body = buildAtomicOrder({
      cart: [oxtail()], reward: { name: "Free plate", amount: -22 }, catalog: CATALOG,
    });
    expect(body.orderCart.discounts[0].amount).toBe(-2200);
  });

  it("adds no discount block when no reward was applied", () => {
    const body = buildAtomicOrder({ cart: [oxtail()], catalog: CATALOG });
    expect(body.orderCart.discounts).toBeUndefined();
  });

  it("ignores a zero-value reward", () => {
    const body = buildAtomicOrder({
      cart: [oxtail()], reward: { name: "Nothing", amount: 0 }, catalog: CATALOG,
    });
    expect(body.orderCart.discounts).toBeUndefined();
  });
});

describe("tax and tip stay off the order", () => {
  const body = buildAtomicOrder({
    cart: [oxtail()], reward: { name: "Free side", amount: 6 }, catalog: CATALOG,
  });
  const json = JSON.stringify(body);

  it("sends no pre-calculated tax — Clover applies the merchant's own rules", () => {
    expect(body.orderCart.taxRates).toBeUndefined();
    expect(body.orderCart.tax).toBeUndefined();
    expect(body.orderCart.taxAmount).toBeUndefined();
    expect(json).not.toMatch(/"tax/i);
    // 8.875% of anything in this cart must not appear anywhere in the payload
    expect(json).not.toContain("178");
  });

  it("sends no tip on the order — a tip is a payment attribute", () => {
    expect(body.orderCart.tip).toBeUndefined();
    expect(body.orderCart.tipAmount).toBeUndefined();
    expect(json).not.toMatch(/tip/i);
  });

  it("sends no order total — Clover computes it from the lines", () => {
    expect(body.orderCart.total).toBeUndefined();
  });
});

describe("payment payload", () => {
  it("carries the token, the amount in cents and the tip separately", () => {
    const p = buildPayment({ source: "tok_123", amountDollars: 21.78, tipDollars: 3, orderId: "ORD-9" });
    expect(p).toEqual({
      source: "tok_123", amount: 2178, currency: "usd",
      tip_amount: 300, metadata: { orderId: "ORD-9" },
    });
  });

  it("omits the tip when there isn't one", () => {
    expect(buildPayment({ source: "tok", amountDollars: 10 }).tip_amount).toBeUndefined();
  });

  it("refuses to charge without a token or for nothing", () => {
    expect(() => buildPayment({ amountDollars: 10 })).toThrow(/token/i);
    expect(() => buildPayment({ source: "tok", amountDollars: 0 })).toThrow(/positive/i);
    expect(() => buildPayment({ source: "tok", amountDollars: -5 })).toThrow(/positive/i);
  });
});

describe("tracking stage from Clover state", () => {
  it("starts at order received", () => {
    expect(trackingStage({ state: "open", printed: false })).toBe(0);
    expect(trackingStage(null)).toBe(0);
  });
  it("moves to the kitchen once the ticket has printed", () => {
    expect(trackingStage({ state: "open", printed: true })).toBe(1);
  });
  it("is ready when Clover says fulfilled", () => {
    expect(trackingStage({ state: "fulfilled" })).toBe(2);
  });
  it("is ready when staff mark it by hand", () => {
    expect(trackingStage({ state: "open", printed: true, manualReady: true })).toBe(2);
  });
});

describe("baked-in modifier ids", () => {
  it("prefers a modifier id from the export over name matching", () => {
    const mods = resolveModifiers(
      [{ gid: "45KGD3ZDMT2ZY", name: "Renamed In Clover", price: 20, mid: "MOD-FROM-EXPORT" }],
      CATALOG
    );
    expect(mods[0].modifier.id).toBe("MOD-FROM-EXPORT");
  });

  it("survives a rename that would break name matching", () => {
    // No catalog at all, but the id is baked in, so the order still builds.
    expect(() => resolveModifiers(
      [{ gid: "GONE", name: "Whatever", price: 5, mid: "MOD-X" }], {}
    )).not.toThrow();
  });
});
