/* Turning a cart into a Clover atomic order.
   Pure functions, no network, no secrets — this is the piece that decides what
   the customer is actually charged, so it is kept separate and tested hard.

   Two things about Clover that drive the shape of this file:

   1. Money is integer cents. The app carries dollars as floats. Every crossing
      of that boundary rounds half-up once, at the last moment.

   2. Modifier prices ADD to the item price, and most of our plates are stored
      with base $0 and the real price sitting in a "size" modifier group. So an
      order whose modifications fail to resolve does not ring up slightly wrong
      — it rings up an Oxtail at $0.00. That is why resolveModifiers throws
      instead of dropping unresolved modifiers: refusing the order is the only
      safe failure. */

/** Dollars (float) -> Clover cents (int). Half-up, matching lib/money.js. */
export const toCents = (dollars) => Math.round((Number(dollars) + 1e-9) * 100);

export class ModifierResolutionError extends Error {
  constructor(unresolved) {
    super(
      `Cannot map ${unresolved.length} modifier(s) onto Clover: ` +
      unresolved.map((u) => `"${u.name}" in group ${u.gid}`).join(", ")
    );
    this.name = "ModifierResolutionError";
    this.unresolved = unresolved;
  }
}

/**
 * Resolve the app's { gid, name, price } modifier selections onto Clover
 * modifier ids, using a catalog fetched from Clover.
 *
 * catalog: { [groupId]: { [modifierName]: { id, price } } }
 *
 * Names are matched case- and space-insensitively because Clover's dashboard
 * and the inventory export disagree about capitalisation ("Mac And Cheese" vs
 * "Mac and Cheese").
 */
const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export function resolveModifiers(modifiers = [], catalog = {}) {
  const out = [];
  const unresolved = [];

  for (const m of modifiers) {
    // A modifier id baked in by the export is authoritative and survives a
    // rename in Clover. Name matching is the fallback for exports that don't
    // carry one.
    if (m.mid) {
      out.push({ modifier: { id: m.mid }, name: m.name, amount: toCents(m.price ?? 0) });
      continue;
    }
    const group = catalog[m.gid];
    const hit = group && Object.keys(group).find((k) => norm(k) === norm(m.name));
    if (!hit) { unresolved.push({ gid: m.gid, name: m.name }); continue; }
    out.push({
      modifier: { id: group[hit].id },
      name: hit,
      amount: toCents(m.price ?? 0),
    });
  }

  if (unresolved.length) throw new ModifierResolutionError(unresolved);
  return out;
}

/**
 * Build the body for POST /v3/merchants/{mId}/atomic_order/orders.
 *
 * Deliberately absent:
 *   - tax. Clover applies the merchant's own tax rules. Sending a
 *     pre-calculated figure would double-tax the order.
 *   - tip. That rides on the payment, not the order.
 */
export function buildAtomicOrder({
  cart,
  reward = null,
  customerId = null,
  pickupLabel = "ASAP",
  note = "",
  catalog = {},
} = {}) {
  if (!Array.isArray(cart) || cart.length === 0) {
    throw new Error("Cannot create an empty order");
  }

  const lineItems = [];
  for (const line of cart) {
    if (!line.itemId) {
      throw new Error(`Cart line "${line.name}" has no Clover item id`);
    }
    const modifications = resolveModifiers(line.modifiers, catalog);
    // Clover has no line-level quantity on atomic orders for modified items;
    // n of the same plate is n line items, which is also how the kitchen
    // ticket needs to read.
    for (let i = 0; i < (line.qty || 1); i++) {
      lineItems.push({
        item: { id: line.itemId },
        ...(modifications.length ? { modifications } : {}),
        ...(line.note ? { note: String(line.note).slice(0, 255) } : {}),
      });
    }
  }

  const orderCart = {
    lineItems,
    title: `Flourish app · pickup ${pickupLabel}`,
    note: note || `Pickup: ${pickupLabel}`,
  };

  // A redeemed reward is an order-level discount. Clover wants it negative.
  // Keyed on magnitude, not sign: a caller handing us -6 means six dollars off,
  // and treating that as "no reward" would quietly charge full price.
  if (reward && Math.abs(Number(reward.amount) || 0) > 0) {
    orderCart.discounts = [{
      name: reward.code ? `${reward.name} (${reward.code})` : reward.name,
      amount: -Math.abs(toCents(reward.amount)),
    }];
  }

  if (customerId) orderCart.customers = [{ id: customerId }];

  return { orderCart };
}

/** Payment body for the ecommerce charge. Tip belongs here, not on the order. */
export function buildPayment({ source, amountDollars, tipDollars = 0, orderId, currency = "usd" }) {
  if (!source) throw new Error("Missing card token");
  const amount = toCents(amountDollars);
  if (!(amount > 0)) throw new Error("Payment amount must be positive");
  return {
    source,
    amount,
    currency,
    ...(tipDollars ? { tip_amount: toCents(tipDollars) } : {}),
    ...(orderId ? { metadata: { orderId } } : {}),
  };
}

/** Clover order state -> the three steps the customer sees. */
export function trackingStage(order) {
  if (!order) return 0;
  const state = String(order.state || "").toLowerCase();
  if (state === "fulfilled" || order.manualReady) return 2;
  if (state === "open" && order.printed) return 1;
  return 0;
}
