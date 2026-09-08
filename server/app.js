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
import {
  api, modifierCatalog, CloverError, humanise,
  printOrderTicket, resolvePrinter, describePrinter,
  paymentStatus, loyaltyConfig,
  sendCustomerMessage, messagingState, printEventUrl,
} from "./clover.js";
import { CONFIGURED, IS_SANDBOX, describe } from "./env.js";
import {
  buildAtomicOrder, buildPayment, toCents, MissingCustomerError,
} from "../src/lib/cloverOrder.js";
import {
  isOpen, nextOpening, describeOpening, closingOn, formatTime, pickupSlots,
  readyFitsBeforeClose,
} from "../src/lib/hours.js";
import { cartPrepMinutes, readyWindow } from "../src/lib/prep.js";
import { isValidName, isValidPhone, phoneDigits } from "../src/lib/phone.js";
import { ADDRESS } from "../src/lib/restaurant.js";
import {
  rateLimit, payRateLimit, checkOrigin, requireAppKey, capCharge,
  describeGuard, ALLOWED_ORIGINS, NATIVE_ORIGINS,
} from "./guard.js";

/* What the customer receives. Kept here rather than inline so the wording is in
   one place — it is the only thing the restaurant "says" to a customer between
   ordering and collecting. */
export const confirmationMessage = (orderNumber, pickupLabel) =>
  `Your order at Flourish BX is confirmed! We'll have it ready ${pickupLabel}. ` +
  `Pay when you pick up at ${ADDRESS}.` + (orderNumber ? ` Order ${orderNumber}` : "");

/* Phone numbers print on tickets and end up in logs. Keep the last two digits —
   enough for staff to match a number they can already see on a ticket, useless
   to anyone reading a log file. */
export const maskPhone = (phone) => {
  const d = phoneDigits(phone);
  return d.length ? `(***) ***-**${d.slice(-2)}` : "(none)";
};

export const readyMessage = (orderNumber) =>
  `Your order at Flourish BX is ready for pickup! Come to ${ADDRESS}.` +
  (orderNumber ? ` Order ${orderNumber}` : "");

export function createApp({
  clover = api,
  catalog = modifierCatalog,
  now = () => new Date(),
  /* Printing is injectable for the same reason the Clover client is: the real
     one retries with a two-second pause, which a test suite must not sit
     through. The default binds the orchestrator to whichever client is in use,
     so the production path is the one in clover.js. */
  printTicket = (orderId) => printOrderTicket(orderId, { client: clover }),
} = {}) {
  const app = express();

  // Behind a host that terminates TLS, req.ip must come from the forwarded
  // header or every caller looks like the proxy and the rate limit is useless.
  app.set("trust proxy", 1);
  /* The native app's own origins are always allowed alongside whatever is
     configured — see NATIVE_ORIGINS in guard.js. */
  app.use(cors({
    origin: ALLOWED_ORIGINS.length
      ? [...ALLOWED_ORIGINS, ...NATIVE_ORIGINS]
      : [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/, ...NATIVE_ORIGINS],
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

    const at = Date.now();
    if (at - probe.at > PROBE_TTL) {
      try { await clover.merchant(); probe = { at, live: true }; }
      catch { probe = { at, live: false }; }
    }

    /* Whether a ticket can actually be printed is the thing staff most need to
       know and the thing nobody could see before. Best effort: a printer lookup
       that fails must not make the app think ordering is off. */
    let printer = null;
    try { ({ printer } = await resolvePrinter({ client: clover })); } catch { /* reported as unconfigured */ }

    res.json({
      ...base,
      configured: probe.live,
      reason: probe.live ? null : "CREDENTIALS_REJECTED",
      printerConfigured: Boolean(printer),
      printerName: printer?.name ?? null,
      printerType: printer?.type ?? null,
      printEventUrl: printEventUrl(),
      messaging: messagingState(),
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
  const closedBody = (at) => ({
    error: `We're closed right now. Flourish opens ${describeOpening(nextOpening(at), at)}.`,
    code: "CLOSED",
    opensAt: nextOpening(at).toISOString(),
  });

  const requireOpen = (_req, res, next) => {
    const at = now();
    if (isOpen(at)) return next();
    return res.status(409).json(closedBody(at));
  };

  /* ---- what the kitchen can promise ----

     The window is worked out HERE, from the cart, and the client displays what
     it is given. Prep time depends on what was ordered — salmon and shrimp meet
     the fryer when the ticket lands and cannot be promised in fifteen minutes —
     so a client computing its own number would quote a plate faster than the
     kitchen can cook it.

     `quote` is also the hours check that matters. Being open is not enough: at
     9:50PM the door is unlocked but a 30-minute plate would come out twenty
     minutes after close, so the ORDER TIME passing is irrelevant and the READY
     TIME is what decides. */
  function quoteFor(cart, at = now()) {
    const prepMinutes = cartPrepMinutes(cart);
    const window = readyWindow(at, prepMinutes);
    return {
      prepMinutes,
      startISO: window.start.toISOString(),
      endISO: window.end.toISOString(),
      label: window.label,
      fitsBeforeClose: readyFitsBeforeClose(window.end, at),
      closesAt: closingOn(at).toISOString(),
    };
  }

  const tooLateBody = (q, at) => ({
    error:
      `There isn't time to cook that before we close at ${formatTime(closingOn(at))}. ` +
      `It needs ${q.prepMinutes} minutes and wouldn't be ready until ${q.label}.`,
    code: "TOO_LATE_TO_COOK",
    prepMinutes: q.prepMinutes,
    closesAt: q.closesAt,
    readyBy: q.endISO,
  });

  app.post("/api/clover/quote", (req, res) => {
    const { cart } = req.body ?? {};
    if (!Array.isArray(cart) || !cart.length) {
      return res.status(400).json({ error: "Cart is empty" });
    }
    const at = now();
    const open = isOpen(at);
    const q = quoteFor(cart, at);
    res.json({
      ...q,
      open,
      // Bookable times for the picker, so the client never derives one either.
      slots: open && q.fitsBeforeClose
        ? pickupSlots(at, q.prepMinutes).map((d) => ({ iso: d.toISOString(), label: formatTime(d) }))
        : [],
      opensAt: open ? null : nextOpening(at).toISOString(),
    });
  });

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

  /* ---- orders ----
     `lastOrder` is what POST /print-test reprints. In memory on purpose: it is
     an operational convenience for staff standing at the counter, not a record
     — Clover holds the orders. */
  let lastOrder = null;

  app.post("/api/clover/orders", requireConfig, requireOpen, async (req, res) => {
    const { cart, reward, customerId, customer, orderNumber, pickupAt, note } = req.body ?? {};
    if (!Array.isArray(cart) || !cart.length) {
      return res.status(400).json({ error: "Cart is empty" });
    }

    /* A ticket with no customer on it is useless at the counter, so it must be
       impossible rather than unlikely. This is refused before anything reaches
       Clover — an order that exists but cannot be handed to anyone is worse
       than an order that was never taken. */
    const name = String(customer?.name ?? "").trim();
    const phone = String(customer?.phone ?? "").trim();
    if (!isValidName(name) || !isValidPhone(phone)) {
      return res.status(400).json({
        error: "We need a name and a 10-digit phone number — staff can't hand over an order without them.",
        code: "CUSTOMER_REQUIRED",
        missing: [
          ...(isValidName(name) ? [] : ["name"]),
          ...(isValidPhone(phone) ? [] : ["phone"]),
        ],
      });
    }

    const at = now();
    const quote = quoteFor(cart, at);
    if (!quote.fitsBeforeClose) {
      return res.status(409).json(tooLateBody(quote, at));
    }

    /* A scheduled slot has to clear the same two bars: not before the kitchen
       could have it, not after the door shuts. Anything else falls back to the
       computed window rather than being taken on trust. */
    let pickupLabel = quote.label;
    if (pickupAt) {
      const when = new Date(pickupAt);
      const valid = !Number.isNaN(when.getTime())
        && when >= new Date(quote.startISO)
        && readyFitsBeforeClose(when, at);
      if (!valid) {
        return res.status(409).json({
          error: `That pickup time has passed or is after we close. The earliest is ${quote.label}.`,
          code: "BAD_PICKUP_TIME",
          earliest: quote.startISO,
          closesAt: quote.closesAt,
        });
      }
      pickupLabel = formatTime(when);
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
        cart: priced, reward, customerId,
        customer: { name, phone },
        orderNumber, pickupLabel, note, catalog: cat,
      });
      const order = await clover.createOrder(body);
      lastOrder = { id: order.id, orderNumber: orderNumber ?? null, at: Date.now() };

      /* Print is best effort. The order exists in Clover either way and staff
         can see it on the register, so a dead printer must not lose the sale —
         but it is a real attempt now: a printer is chosen from the merchant's
         own list, the event names it, and a failure is retried once. */
      /* Printing is best effort, and that has to hold even if the print path
         throws rather than returning a failure. The order is already on the
         register; losing it to a printer problem is the one outcome this whole
         section exists to avoid. */
      let print;
      try {
        print = await printTicket(order.id);
      } catch (e) {
        print = {
          printed: false, printer: null,
          printError: e?.message ?? "Print failed",
          status: e?.status ?? null,
          url: e?.url ?? printEventUrl(),
        };
      }
      if (!print.printed) {
        /* The URL goes in the log next to the status. "405 POST not allowed"
           on its own says the path is not routed while omitting the one thing
           that would identify it. */
        console.warn(
          `  order ${order.id}: ticket not printed ` +
          `(${print.status ?? "?"} ${print.printError ?? "unknown"}) POST ${print.url ?? "(no url)"}`
        );
      }

      /* Everything below is cosmetic. Attaching the customer and messaging them
         is nice; losing the order because Clover's messaging is not on this
         merchant's plan would not be. Each step is caught on its own so one
         failing does not skip the next. */
      let messaged = false, attached = false, customerRef = customerId ?? null;
      try {
        if (!customerRef) {
          const found = await clover.findCustomerByPhone(phone);
          customerRef = found?.elements?.[0]?.id ?? null;
          if (!customerRef) {
            const [firstName, ...rest] = name.split(/\s+/);
            const made = await clover.createCustomer({
              firstName: firstName || "Guest",
              lastName: rest.join(" ") || undefined,
              phone,
            });
            customerRef = made?.id ?? null;
          }
        }
        if (customerRef) {
          await clover.attachCustomer(order.id, customerRef);
          attached = true;
        }
      } catch (e) {
        // The register still shows the customer's name and number on the
        // ticket note, so the order stands.
        console.warn(
          `  order ${order.id}: customer ${maskPhone(phone)} not attached (${e?.message ?? "unknown"})`
        );
      }

      /* Messaging is detected once and then left alone. It is not on this
         merchant's plan, and warning about it on every single order buried the
         printing failure underneath it — two unrelated problems reporting the
         identical 405. This shares no error handling with the print above. */
      messaged = await sendCustomerMessage(
        order.id, confirmationMessage(orderNumber, pickupLabel), { client: clover }
      );

      /* success:true even when the printer refused. The order is on the
         register either way, and telling a customer their food failed when it
         did not is the worse mistake — but `printed` is now the truth of what
         happened, so the confirmation screen can stop guessing. */
      res.json({
        success: true,
        orderId: order.id,
        orderNumber: orderNumber ?? null,
        total: order.total ?? null,
        paid: false,          // pay-at-pickup: nothing is collected here
        printed: print.printed,
        printError: print.printError ?? null,
        printer: print.printer ?? null,
        messaged, attached,
        pickupLabel,
        readyWindow: { startISO: quote.startISO, endISO: quote.endISO, label: quote.label },
        prepMinutes: quote.prepMinutes,
      });
    } catch (e) {
      if (e instanceof MissingCustomerError) {
        return res.status(400).json({ error: e.message, code: "CUSTOMER_REQUIRED", missing: e.missing });
      }
      fail(res, e);
    }
  });

  /* ---- printers ----
     Staff and whoever is deploying this need to see what the server chose, and
     be able to prove a ticket prints without putting a fake order through the
     kitchen. */
  app.get("/api/clover/printers", requireConfig, async (_req, res) => {
    try {
      const { printer, printers } = await resolvePrinter({ client: clover });
      res.json({
        chosen: describePrinter(printer),
        printers: printers.map(describePrinter),
      });
    } catch (e) { fail(res, e); }
  });

  /* ALWAYS answers with JSON — including when there is no order to reprint and
     when the print fails. This returned an empty body on the no-order path,
     which gave curl nothing to parse and made a diagnostic tool need its own
     diagnosing. Every branch carries the resolved URL, so the thing being
     tested is visible in the answer. */
  app.post("/api/clover/print-test", requireConfig, async (_req, res) => {
    const url = printEventUrl();
    if (!lastOrder) {
      return res.status(404).json({
        ok: false,
        printed: false,
        error: "No order has been placed through the app yet, so there is nothing to reprint.",
        code: "NO_RECENT_ORDER",
        url,
        orderId: null,
        orderNumber: null,
      });
    }
    try {
      const print = await printTicket(lastOrder.id);
      return res.status(print.printed ? 200 : 502).json({
        ok: print.printed,
        printed: print.printed,
        printer: print.printer ?? null,
        error: print.printError ?? null,
        status: print.status ?? null,
        url: print.url ?? url,
        orderId: lastOrder.id,
        orderNumber: lastOrder.orderNumber,
      });
    } catch (e) {
      // printOrderTicket is contracted never to throw; if it ever does, this
      // endpoint still answers in JSON rather than hanging up on the caller.
      return res.status(500).json({
        ok: false,
        printed: false,
        error: e?.message ?? "Print failed",
        status: e?.status ?? null,
        url: e?.url ?? url,
        orderId: lastOrder.id,
        orderNumber: lastOrder.orderNumber,
      });
    }
  });

  /* ---- has it been paid for? ----
     The app collects no money, so this is the only way to know. Loyalty points
     hang on the answer: they are awarded on a confirmed payment and never on
     an order being placed, because at that moment the customer owes for food
     they have not paid for and may never collect. */
  app.get("/api/clover/orders/:orderId/status", requireConfig, async (req, res) => {
    try {
      const o = await clover.getOrder(req.params.orderId);
      const status = paymentStatus(o);
      res.json({
        id: o.id,
        ...status,
        printed: Boolean(o.printed),
        manualReady: Boolean(o.manualReady),
        // Nothing more to wait for: the client can stop polling.
        settled: status.paid || status.voided,
      });
    } catch (e) {
      /* A deleted order 404s. That is an answer, not a failure — it is the
         "voided at the register" case, and the client must stop polling and
         award nothing. */
      if (e instanceof CloverError && e.status === 404) {
        return res.json({
          id: req.params.orderId,
          paid: false, voided: true, refunded: false,
          paymentState: null, state: "deleted",
          total: 0, amountPaid: 0,
          printed: false, manualReady: false,
          settled: true,
        });
      }
      fail(res, e);
    }
  });

  /* ---- whose loyalty rules apply ----
     If the merchant runs Clover's own programme its rules win, because two
     schemes disagreeing about a customer's balance is worse than either. A
     merchant without one is the ordinary case and gets our in-app scheme. */
  app.get("/api/clover/loyalty", requireConfig, async (_req, res) => {
    const cfg = await loyaltyConfig({ client: clover });
    res.json({
      ...cfg,
      source: cfg.configured ? "clover" : "in-app",
    });
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

    const messaged = await sendCustomerMessage(
      orderId, readyMessage(orderNumber), { client: clover }
    );
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
