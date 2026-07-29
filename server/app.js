/* The proxy. Exported separately from index.js so tests can mount it without
   binding a port.

   This server exists for one reason: to keep CLOVER_PRIVATE_TOKEN off the
   customer's device. Everything that needs that token — creating orders,
   charging cards, reading and writing inventory — happens here.

   Two things it deliberately does NOT trust from the client:

   - prices. A cart line arrives with a price attached, but the server recomputes
     every line from Clover's own modifier catalog. Otherwise anyone with dev
     tools could POST an Oxtail at $0.01.
   - the modifier list resolving cleanly. Most plates are base $0 with the price
     in a size modifier, so an order with unresolved modifications rings up free.
     That is a hard failure, not a warning. */
import express from "express";
import cors from "cors";
import { api, modifierCatalog, CloverError, humanise } from "./clover.js";
import { CONFIGURED, IS_SANDBOX, describe } from "./env.js";
import { buildAtomicOrder, buildPayment, toCents } from "../src/lib/cloverOrder.js";
import { isOpen, nextOpening, describeOpening, READY_WINDOW } from "../src/lib/hours.js";
import { ADDRESS } from "../src/lib/restaurant.js";
import {
  rateLimit, payRateLimit, checkOrigin, requireAppKey, capCharge,
  describeGuard, ALLOWED_ORIGINS,
} from "./guard.js";

/* What the customer receives. Kept here rather than inline so the wording is in
   one place — it is the only thing the restaurant "says" to a customer between
   ordering and collecting. */
export const confirmationMessage = (orderNumber) =>
  `Your order at Flourish BX is confirmed! We'll have it ready in ${READY_WINDOW}. ` +
  `Pay when you pick up at ${ADDRESS}.` + (orderNumber ? ` Order ${orderNumber}` : "");

export const readyMessage = (orderNumber) =>
  `Your order at Flourish BX is ready for pickup! Come to ${ADDRESS}.` +
  (orderNumber ? ` Order ${orderNumber}` : "");

export function createApp({ clover = api, catalog = modifierCatalog, now = () => new Date() } = {}) {
  const app = express();

  // Behind a host that terminates TLS, req.ip must come from the forwarded
  // header or every caller looks like the proxy and the rate limit is useless.
  app.set("trust proxy", 1);
  app.use(cors({
    origin: ALLOWED_ORIGINS.length
      ? ALLOWED_ORIGINS
      : [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/],
  }));
  app.use(express.json({ limit: "64kb" }));
  app.use("/api/clover", checkOrigin, rateLimit());

  /* ---- health ----
     Credentials being *present* is not the same as them *working*. Reporting
     "configured" from the env alone would put the app in online mode, offer a
     card form, and then fail every call — worse than preview mode, which at
     least tells the customer the truth. So this actually asks Clover, and
     caches the answer briefly so a reload doesn't hammer the API. */
  let probe = { at: 0, live: false };
  const PROBE_TTL = 30_000;

  app.get("/api/clover/health", async (_req, res) => {
    const base = { ok: true, ...describe(), sandbox: IS_SANDBOX };
    if (!CONFIGURED) return res.json({ ...base, configured: false, reason: "NO_CREDENTIALS" });

    const now = Date.now();
    if (now - probe.at > PROBE_TTL) {
      try { await clover.merchant(); probe = { at: now, live: true }; }
      catch { probe = { at: now, live: false }; }
    }
    res.json({
      ...base,
      configured: probe.live,
      reason: probe.live ? null : "CREDENTIALS_REJECTED",
    });
  });

  const fail = (res, e) => {
    if (e instanceof CloverError) {
      // An auth failure is our problem, never the customer's: report it as a
      // gateway fault and re-humanise here rather than trusting the message
      // already on the error. This is the last boundary before the wire, so a
      // raw Clover string must not be able to slip through it.
      if (e.status === 401 || e.status === 403) {
        return res.status(502).json({ error: humanise(e.status, e.body), code: "CREDENTIALS" });
      }
      return res.status(e.status).json({ error: e.message, code: e.body?.code });
    }
    if (e?.name === "ModifierResolutionError") {
      return res.status(409).json({
        error: "One of those choices is no longer on the register. Rebuild the item and try again.",
        code: "MODIFIER_UNRESOLVED",
        unresolved: e.unresolved,
      });
    }
    return res.status(500).json({ error: e?.message || "Unexpected server error" });
  };

  // Everything past health needs the app key. Health does not, because the app
  // calls it to decide whether ordering is available at all.
  app.use("/api/clover", (req, res, next) =>
    req.path === "/health" ? next() : requireAppKey(req, res, next));

  const requireConfig = (_req, res, next) =>
    CONFIGURED ? next() : res.status(503).json({ error: "Clover is not configured", code: "NOT_CONFIGURED" });

  /* The kitchen is shut, so nothing may be ordered or charged.
     The checkout already disables its button, but that is a courtesy to an
     honest client — a stale tab left open past closing, or a request replayed
     by hand, would otherwise land a ticket nobody is there to cook.

     Hours are New York wall-clock. server/index.js pins TZ so a host running in
     UTC does not decide the Bronx is open at 4am. */
  const requireOpen = (_req, res, next) => {
    const at = now();
    if (isOpen(at)) return next();
    return res.status(409).json({
      error: `We're closed right now. Flourish opens ${describeOpening(nextOpening(at), at)}.`,
      code: "CLOSED",
      opensAt: nextOpening(at).toISOString(),
    });
  };

  /* ---- inventory ---- */
  app.get("/api/clover/inventory", requireConfig, async (_req, res) => {
    try {
      const data = await clover.items();
      // Only what the client needs; no cost prices, no internal flags.
      const items = (data?.elements ?? []).map((i) => ({
        id: i.id,
        name: i.name,
        stockCount: i.stockCount ?? null,
        hidden: Boolean(i.hidden),
        available: i.stockCount === undefined || i.stockCount === null || i.stockCount > 0,
      }));
      res.json({ items });
    } catch (e) { fail(res, e); }
  });

  app.post("/api/clover/inventory/:itemId/stock", requireConfig, async (req, res) => {
    const n = Number(req.body?.stockCount);
    if (!Number.isInteger(n) || n < 0) {
      return res.status(400).json({ error: "stockCount must be a non-negative integer" });
    }
    try { res.json(await clover.setStock(req.params.itemId, n)); }
    catch (e) { fail(res, e); }
  });

  /* ---- orders ---- */
  app.post("/api/clover/orders", requireConfig, requireOpen, async (req, res) => {
    const { cart, reward, customerId, customer, orderNumber, pickupLabel, note } = req.body ?? {};
    if (!Array.isArray(cart) || !cart.length) {
      return res.status(400).json({ error: "Cart is empty" });
    }
    try {
      const cat = await catalog();

      // Recompute every line from Clover's catalog. The client's prices are
      // display state; they are never what we bill.
      const priced = cart.map((line) => {
        const mods = (line.modifiers ?? []).map((mm) => {
          const group = cat[mm.gid] || {};
          const key = Object.keys(group).find(
            (k) => k.trim().toLowerCase() === String(mm.name).trim().toLowerCase()
          );
          return { ...mm, price: key ? group[key].price : mm.price };
        });
        return { ...line, modifiers: mods };
      });

      const body = buildAtomicOrder({
        cart: priced, reward, customerId, customer, orderNumber,
        pickupLabel, note, catalog: cat,
      });
      const order = await clover.createOrder(body);

      // Print is best effort. The order exists in Clover either way and staff
      // can see it on the register, so a dead printer must not lose the sale.
      let printed = false, printError = null;
      try { await clover.printOrder(order.id); printed = true; }
      catch (e) { printError = e instanceof CloverError ? e.message : "Print failed"; }

      /* Everything below is cosmetic. Attaching the customer and messaging them
         is nice; losing the order because Clover's messaging is not on this
         merchant's plan would not be. Each step is caught on its own so one
         failing does not skip the next. */
      let messaged = false, customerRef = customerId ?? null;
      if (customer?.phone) {
        try {
          if (!customerRef) {
            const found = await clover.findCustomerByPhone(customer.phone);
            customerRef = found?.elements?.[0]?.id ?? null;
            if (!customerRef) {
              const [firstName, ...rest] = String(customer.name || "").trim().split(/\s+/);
              const made = await clover.createCustomer({
                firstName: firstName || "Guest",
                lastName: rest.join(" ") || undefined,
                phone: customer.phone,
              });
              customerRef = made?.id ?? null;
            }
          }
          if (customerRef) await clover.attachCustomer(order.id, customerRef);
        } catch { /* the order stands without a customer attached */ }

        try {
          await clover.sendOrderMessage(order.id, confirmationMessage(orderNumber));
          messaged = true;
        } catch (e) {
          // Not on every Clover plan. Worth knowing, not worth failing.
          console.warn(`  order ${order.id}: customer message not sent (${e?.message ?? "unknown"})`);
        }
      }

      /* success:true even when the printer refused. The order is on the
         register either way, and telling a customer their food failed when it
         did not is the worse mistake. */
      res.json({
        success: true,
        orderId: order.id,
        orderNumber: orderNumber ?? null,
        total: order.total ?? null,
        paid: false,          // pay-at-pickup: nothing is collected here
        printed, printError, messaged,
      });
    } catch (e) { fail(res, e); }
  });

  app.get("/api/clover/orders/:orderId", requireConfig, async (req, res) => {
    try {
      const o = await clover.getOrder(req.params.orderId);
      res.json({
        id: o.id, state: o.state, total: o.total,
        printed: Boolean(o.printed), manualReady: Boolean(o.manualReady),
      });
    } catch (e) { fail(res, e); }
  });

  /* ---- staff: mark an order ready ----
     Flips the Clover order to fulfilled, which is what the customer's tracking
     screen is polling for, and messages them. The message is best effort; the
     state change is the part that matters. */
  app.post("/api/clover/orders/:orderId/ready", requireConfig, async (req, res) => {
    const { orderId } = req.params;
    const orderNumber = req.body?.orderNumber ?? null;
    try {
      await clover.fulfillOrder(orderId);
    } catch (e) { return fail(res, e); }

    let messaged = false;
    try {
      await clover.sendOrderMessage(orderId, readyMessage(orderNumber));
      messaged = true;
    } catch (e) {
      console.warn(`  order ${orderId}: ready message not sent (${e?.message ?? "unknown"})`);
    }
    res.json({ success: true, orderId, state: "fulfilled", messaged });
  });

  /* ---- payment ---- */
  app.post("/api/clover/pay", requireConfig, requireOpen, payRateLimit(), capCharge, async (req, res) => {
    const { source, amountDollars, tipDollars, orderId } = req.body ?? {};
    if (!source) return res.status(400).json({ error: "Missing card token" });
    if (!(toCents(amountDollars) > 0)) {
      return res.status(400).json({ error: "Payment amount must be positive" });
    }
    try {
      const charge = await clover.charge(buildPayment({ source, amountDollars, tipDollars, orderId }));
      res.json({ chargeId: charge.id, status: charge.status, amount: charge.amount });
    } catch (e) {
      // A decline is the customer's business and should be quoted back to them.
      if (e instanceof CloverError && e.status === 402) {
        return res.status(402).json({
          error: humanise(402, e.body) || "Card declined.",
          code: e.body?.error?.code || "CARD_DECLINED",
          declineReason: e.body?.error?.decline_code || null,
        });
      }
      fail(res, e);
    }
  });

  /* ---- customers ---- */
  app.post("/api/clover/customers", requireConfig, async (req, res) => {
    const { name, phone } = req.body ?? {};
    if (!name || !phone) return res.status(400).json({ error: "Name and phone are required" });
    try {
      const found = await clover.findCustomerByPhone(phone);
      const hit = found?.elements?.[0];
      if (hit) return res.json({ customerId: hit.id, existing: true });

      const [firstName, ...rest] = String(name).trim().split(/\s+/);
      const created = await clover.createCustomer({
        firstName, lastName: rest.join(" ") || undefined, phone,
      });
      res.json({ customerId: created.id, existing: false });
    } catch (e) { fail(res, e); }
  });

  app.get("/api/clover/customers", requireConfig, async (req, res) => {
    const phone = String(req.query.phone ?? "");
    if (!phone) return res.status(400).json({ error: "phone is required" });
    try {
      const found = await clover.findCustomerByPhone(phone);
      const hit = found?.elements?.[0];
      res.json({ customerId: hit?.id ?? null });
    } catch (e) { fail(res, e); }
  });

  return app;
}
