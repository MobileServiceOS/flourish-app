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
import { readFileSync } from "node:fs";
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
  cleanVehicle,
} from "../src/lib/cloverOrder.js";
import {
  isOpen, nextOpening, describeOpening, closingOn, formatTime, pickupSlots,
  readyFitsBeforeClose,
} from "../src/lib/hours.js";
import { cartPrepMinutes, readyWindow } from "../src/lib/prep.js";
import { unavailableInCart, unavailableMessage, dayOfWeek } from "../src/lib/availability.js";
import { isValidName, isValidPhone, phoneDigits } from "../src/lib/phone.js";
import { REWARDS, discountFor } from "../src/lib/loyalty.js";
import { MENU, PLATE_IDS, DRINK_ID, SIDE_ID } from "../src/data/menu.data.js";

/* What is actually running. Added because the app is live and the question
   "is the deployed proxy newer or older than the published app" had no answer
   — /health carried nothing to tell versions apart, and there is no safe way to
   probe for it: every request that would reveal the new reward handling reaches
   that check only AFTER the point where an old build would have created a real
   order on the register.

   That matters in one direction especially. A published app that sends
   `rewardId` against a proxy predating the server-authoritative discount gets
   no discount at all — the old proxy reads `reward`, which the new client no
   longer sends — and the customer is charged full price at the counter having
   been told a reward applied. Being able to read the deployed commit is how
   that gets caught in seconds instead of at the till. */
const BUILD = (() => {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return {
      version: pkg.version ?? null,
      /* Railway sets this on every deploy. Null anywhere else, which is itself
         informative: it means this is not a Railway deployment. */
      commit: (process.env.RAILWAY_GIT_COMMIT_SHA ?? "").slice(0, 7) || null,
    };
  } catch {
    return { version: null, commit: null };
  }
})();
import { ADDRESS } from "../src/lib/restaurant.js";
import {
  rateLimit, payRateLimit, checkOrigin, requireAppKey, requireAppKeyWith, capCharge,
  describeGuard, ALLOWED_ORIGINS, NATIVE_ORIGINS,
} from "./guard.js";

/* ============================================================================
   THE DISCOUNT IS THE SERVER'S NUMBER, NOT THE CLIENT'S

   Every line on an order is re-priced from Clover's own catalog before the
   order is built, because the client's prices are display state. The reward
   discount was the one number that escaped that: the client sent
   `reward: { name, code, amount }` and the amount went onto the Clover order
   untouched. A crafted request could take $250 off a real order — no account,
   no Petals, no redemption — and since the app collects no money the attacker
   simply paid the discounted total at the counter. The charge ceiling would not
   have caught it either: `capCharge` guards /pay, and this flow never goes
   there.

   So the client now sends a `rewardId` and nothing else. The cost, the name and
   the cap come from REWARDS here, the amount is computed here from the
   re-priced cart, and a body that tries to assert an amount is refused rather
   than quietly corrected — a client sending one is either an old build or an
   attack, and both are worth failing loudly.

   WHAT IS STILL NOT VERIFIED, stated plainly: the server has no idea whether
   the customer had the Petals to spend. Balances live only on the device
   (src/lib/storage.js), so "did they earn this" is a question nothing here can
   answer, and the voucher code is an unvalidatable string kept for staff
   reference. What this fix buys is a bound: a reward can only ever be one of
   the five in REWARDS, and only ever worth up to its own cap against a line
   that actually qualifies. Unbounded became bounded. Closing it completely
   needs server-side balances.
   ============================================================================ */

/* Item base prices, by Clover id. Derived from the generated menu rather than
   exported by it, so this needs no regeneration to stay in step. */
const ITEM_BASE = new Map(MENU.flatMap((c) => c.items).map((i) => [i.id, i.base]));

/**
 * A cart line as the SERVER sees it, for reward matching.
 *
 * Rebuilt rather than filtered, so no client-asserted field can reach
 * `discountFor`:
 *
 *   price  — the item's own base plus the modifiers Clover's catalog prices.
 *            Most plates are base $0 with the real money in a size group, so
 *            this is overwhelmingly Clover's number. The base is the app's
 *            menu price (see the two rules in CLAUDE.md); it only decides which
 *            line is the dearest eligible one, and the reward's cap bounds the
 *            answer either way.
 *   plate  — from PLATE_IDS, not the client's `plate` boolean, which is what
 *            the "free plate" reward keys on.
 *   meta   — the resolved modifier NAMES, so the seafood-mac reward matches on
 *            what was actually ordered rather than on a display string.
 */
function trustedLine(line, cat) {
  const mods = (line.modifiers ?? []).map((mm) => {
    const group = cat[mm.gid] || {};
    const key = Object.keys(group).find(
      (k) => k.trim().toLowerCase() === String(mm.name).trim().toLowerCase()
    );
    return { name: key ?? mm.name, price: key ? group[key].price : 0 };
  });
  return {
    itemId: line.itemId,
    plate: PLATE_IDS.has(line.itemId),
    meta: mods.map((m) => m.name).join(" "),
    price: (ITEM_BASE.get(line.itemId) ?? 0) + mods.reduce((n, m) => n + (Number(m.price) || 0), 0),
  };
}

/** What the cart is worth, by the server's reckoning rather than the client's. */
const trustedSubtotal = (cart, cat) =>
  cart.reduce((n, line) => n + trustedLine(line, cat).price * (Number(line.qty) || 1), 0);

/** A voucher code is display-only and unverified, so it is never trusted as text. */
const cleanRewardCode = (code) =>
  String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);

/**
 * The reward to put on the order, or an error to refuse it with.
 *
 * Returns `{ reward }` (possibly null, for an order with no reward) or
 * `{ error }` carrying the status and body to send.
 */
export function resolveReward(body, pricedCart, cat) {
  const { rewardId, rewardCode } = body ?? {};

  /* The client may not assert an amount, in any shape. Refused rather than
     ignored: silently dropping it would let a compromised or stale client
     believe a discount was applied that never was, and the customer would
     argue with the till. */
  const asserted = body?.reward ?? null;
  if (asserted !== null && typeof asserted === "object" && "amount" in asserted) {
    return { error: { status: 400, body: {
      error: "The discount is worked out here, not sent in.",
      code: "REWARD_AMOUNT_NOT_ACCEPTED",
    } } };
  }
  if (body?.discount !== undefined || body?.rewardAmount !== undefined) {
    return { error: { status: 400, body: {
      error: "The discount is worked out here, not sent in.",
      code: "REWARD_AMOUNT_NOT_ACCEPTED",
    } } };
  }

  if (!rewardId) return { reward: null };

  /* One reward per order, enforced by shape as well as by intent: an array of
     ids, or anything that is not a plain string, is refused rather than
     coerced. Two rewards on one order is the stacking this forbids, and the
     app cannot see the OTHER half — a customer using a Perks $5 off at the
     counter on this same order is invisible to every API we have, which is why
     the copy says one reward per order and staff hold the Perks side. */
  if (typeof rewardId !== "string" || Array.isArray(body?.rewardIds)) {
    return { error: { status: 400, body: {
      error: "One reward per order.",
      code: "ONE_REWARD_PER_ORDER",
    } } };
  }

  const r = REWARDS.find((x) => x.id === rewardId);
  if (!r) {
    return { error: { status: 400, body: {
      error: "That reward doesn't exist.",
      code: "UNKNOWN_REWARD",
    } } };
  }

  const lines = pricedCart.map((l) => trustedLine(l, cat));
  const amount = discountFor({ rid: r.id }, lines);

  /* Nothing in the cart the reward applies to. A customer who redeemed a free
     drink and then emptied the drink out of their cart is the honest version of
     this; refusing is the only answer that keeps the app and the till agreeing. */
  if (!(amount > 0)) {
    return { error: { status: 400, body: {
      error: `Add ${r.needs} to use ${r.name}.`,
      code: "REWARD_NOT_APPLICABLE",
      needs: r.needs,
    } } };
  }

  /* discountFor already caps, so this cannot fire from that path. It is here
     because the cap is the only thing bounding the loss if it ever could. */
  if (amount > r.cap) {
    return { error: { status: 400, body: {
      error: "That reward is worth less than that.",
      code: "REWARD_OVER_CAP",
      cap: r.cap,
    } } };
  }

  return { reward: { name: r.name, code: cleanRewardCode(rewardCode) || null, amount } };
}

/* ---------- replaying the same order ----------
   A double-tap, a retried request after a timeout, or a client that never saw
   the response must not create a second discounted order in Clover. The client
   mints a key per order attempt and re-sends the same one on retry; a repeat
   gets the first response back instead of a new order.

   In memory, like the rate limiter, and fine for one process — behind more than
   one instance this needs shared storage or it becomes per-instance.

   This protects honest clients. It is NOT an attack control: anything crafting
   a request can vary the key freely, which is why the cap above is what
   actually bounds a forged discount. */
const REPLAY_TTL_MS = 10 * 60_000;
const orderReplies = new Map();   // idempotencyKey -> { at, status, body }
const ordersInFlight = new Set();

function replayOf(key) {
  if (!key) return null;
  const hit = orderReplies.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > REPLAY_TTL_MS) { orderReplies.delete(key); return null; }
  return hit;
}

function rememberReply(key, status, body) {
  if (!key) return;
  orderReplies.set(key, { at: Date.now(), status, body });
  // Cheap sweep, so a long-running process does not hold every key forever.
  if (orderReplies.size > 500) {
    const cutoff = Date.now() - REPLAY_TTL_MS;
    for (const [k, v] of orderReplies) if (v.at < cutoff) orderReplies.delete(k);
  }
}

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
  /* Injectable for the same reason the Clover client is. Left undefined, the
     key is read from the environment on every request, which is production
     behaviour; a test passes one so it never has to mutate process.env, which
     vitest shares between workers. */
  appKey,
  /* Server-side Petals, or null when no DATABASE_URL is configured. Null is a
     supported state, not a degraded one: the endpoints answer 503 with a code
     the app understands, ordering carries on untouched, and nothing is redeemed
     against a balance nobody can verify. There is deliberately NO in-memory
     fallback — a proxy quietly holding balances in memory would lose them on
     the next deploy and nobody would find out until a customer complained. */
  petals = null,
} = {}) {
  const guardAppKey = appKey === undefined ? requireAppKey : requireAppKeyWith(() => appKey);
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
    /* `petals` so "are server-side balances on?" is answerable without POSTing
       a phone number at the balance endpoint to see whether it 503s. */
    const base = {
      ok: true, ...describe(), sandbox: IS_SANDBOX, build: BUILD,
      petals: petals ? "server-side" : "off",
    };
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
    req.path === "/health" ? next() : guardAppKey(req, res, next));

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
    const { cart, customerId, customer, orderNumber, pickupAt, curbside } = req.body ?? {};
    const idem = typeof req.body?.idempotencyKey === "string"
      ? req.body.idempotencyKey.slice(0, 100) : null;
    if (!Array.isArray(cart) || !cart.length) {
      return res.status(400).json({ error: "Cart is empty" });
    }

    /* Already answered this exact attempt: hand back the same answer rather
       than creating a second order. Checked before any work, so a double-tap
       costs one Clover call, not two. */
    const seen = replayOf(idem);
    if (seen) return res.status(seen.status).json({ ...seen.body, replayed: true });
    if (idem && ordersInFlight.has(idem)) {
      return res.status(409).json({
        error: "That order is already going through.",
        code: "ORDER_IN_FLIGHT",
      });
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

    /* Curbside without a vehicle description is a ticket that tells staff to
       walk food out to a car they cannot identify. Refused for the same reason
       an order with no customer is: it is not actionable at the counter. */
    if (curbside?.waiting && !cleanVehicle(curbside)) {
      return res.status(400).json({
        error: "We need to know what you're driving so staff can find you.",
        code: "VEHICLE_REQUIRED",
      });
    }

    const at = now();

    /* Day locks, both kinds, checked in one pass.

       Some dishes are only cooked on certain days, and some OPTIONS inside a
       group are — soup is chicken Sunday to Thursday and seafood Friday and
       Saturday. The menu greys both out, but that is a courtesy to an honest
       client: a tab left open overnight, or a request replayed by hand, would
       otherwise put Friday's seafood soup on a Tuesday ticket.

       Same reasoning as the hours guard, and the day is New York's day no
       matter what timezone the caller is in — see lib/availability.js. */
    const unavailable = unavailableInCart(cart, at);
    if (unavailable.length) {
      return res.status(409).json({
        error: unavailableMessage(unavailable),
        code: "NOT_AVAILABLE_TODAY",
        today: dayOfWeek(at),
        unavailable: unavailable.map(({ kind, name, days, label }) => ({ kind, name, days, label })),
      });
    }

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

    if (idem) ordersInFlight.add(idem);
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

      /* The discount, worked out here from the re-priced cart. Same shape as
         the line re-pricing directly above — it simply never included the one
         number the client was allowed to name. */
      const resolved = resolveReward(req.body, priced, cat);
      if (resolved.error) {
        return res.status(resolved.error.status).json(resolved.error.body);
      }
      const reward = resolved.reward;

      /* BEFORE the order goes to Clover, check the balance can pay for the
         reward — and refuse the whole order if it cannot.

         The order of operations is the opposite of everything else here, where
         the order is pushed first because a ticket on the register is the thing
         that matters. A reward is different: an order created with a discount
         the customer has not got is money off the till that no later step can
         claw back, and the customer is standing at the counter with the food.
         Refusing is recoverable — they order again without the reward.

         The RESERVATION itself is taken after the order exists, because it is
         keyed on the Clover order id. So this is a check first, then the hold;
         the window between them is a few hundred milliseconds on one process,
         and the hold is idempotent on the order id. */
      if (reward && petals) {
        const r = REWARDS.find((x) => x.id === req.body?.rewardId);
        try {
          const bal = await petals.balance({ name, phone });
          if (!bal.known || bal.petals < r.cost) {
            return res.status(409).json({
              error: bal.known
                ? "There aren't enough Petals on that balance."
                : "We can't find a rewards balance on that number.",
              code: bal.known ? "INSUFFICIENT_PETALS" : "NO_BALANCE",
              available: bal.petals, needed: r.cost,
            });
          }
        } catch (e) {
          /* Cannot verify means cannot redeem. Never fall back to trusting the
             client's word for a balance — that is the whole reason this moved
             off the device. */
          const code = e?.name === "PetalsError" ? e.code : "PETALS_UNAVAILABLE";
          return res.status(e?.name === "PetalsError" ? 400 : 503).json({
            error: e?.name === "PetalsError" ? e.message : "Rewards aren't available right now.",
            code,
          });
        }
      }

      const body = buildAtomicOrder({
        cart: priced, reward, customerId,
        customer: { name, phone },
        orderNumber, pickupLabel, catalog: cat,
        curbside: curbside?.waiting ? curbside : null,
      });
      const order = await clover.createOrder(body);
      lastOrder = { id: order.id, orderNumber: orderNumber ?? null, at: Date.now() };

      /* Hold the Petals against this order. Nothing was deducted when the
         customer tapped redeem — that is a choice, not a spend — and nothing is
         deducted for good until Clover confirms the payment. Reserve now,
         settle on paid, release on void.

         A failure here does NOT fail the order. The ticket is already on the
         register and the discount is already on it; losing the sale over a
         ledger write would be the wrong trade. It is logged loudly, and the
         cost is that one reward went unpaid-for — bounded by the reward's own
         cap, which is why that cap exists. */
      /* One Petals row per order, reward or not. The EARNABLE is computed here
         from the re-priced cart, for the same reason the discount is: the
         client used to own that number, and it has to survive until Clover
         confirms the payment, by which time the cart is long gone. A phone with
         no balance has not joined, so no row is written and nothing is earned —
         the server does not enrol someone because they gave a number. */
      let petalsRow = null;
      if (petals) {
        const net = Math.max(0, trustedSubtotal(priced, cat) - (reward?.amount ?? 0));
        try {
          const opened = await petals.openOrder({
            phone, name,
            orderId: order.id,
            rewardId: req.body?.rewardId ?? null,
            cost: reward ? (REWARDS.find((x) => x.id === req.body?.rewardId)?.cost ?? 0) : 0,
            amountCents: toCents(reward?.amount ?? 0),
            earnable: Math.round(net),
          });
          petalsRow = opened.row ?? null;
        } catch (e) {
          /* Never fails the order. The ticket is on the register and the
             discount is already on it; losing the sale over a ledger write
             would be the wrong trade. The cost is one reward unpaid-for,
             bounded by its own cap — which is why that cap exists. */
          console.warn(
            `  order ${order.id}: Petals row NOT written (${e?.message ?? "unknown"}) — ` +
            `the discount stands, the balance was not charged, nothing will be earned`
          );
        }
      }

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
      const payload = {
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
        curbside: curbside?.waiting ? { vehicle: cleanVehicle(curbside) } : null,
        readyWindow: { startISO: quote.startISO, endISO: quote.endISO, label: quote.label },
        prepMinutes: quote.prepMinutes,
        /* What was actually taken off, so the confirmation screen shows the
           server's number rather than the one the client hoped for. */
        discount: reward ? { name: reward.name, amount: reward.amount } : null,
        /* What the ledger actually recorded, so the client shows a balance that
           matches it rather than one it worked out itself. */
        petalsHeld: petalsRow ? petalsRow.hold : 0,
        petalsEarnable: petalsRow ? petalsRow.earnable : 0,
      };
      /* Only successes are remembered. A failed attempt has created nothing, so
         a retry of it must be allowed to go through. */
      rememberReply(idem, 200, payload);
      res.json(payload);
    } catch (e) {
      if (e instanceof MissingCustomerError) {
        return res.status(400).json({ error: e.message, code: "CUSTOMER_REQUIRED", missing: e.missing });
      }
      fail(res, e);
    } finally {
      if (idem) ordersInFlight.delete(idem);
    }
  });

  /* ============================================================================
     PETALS — the balance is the server's, not the device's

     It used to live in one JSON blob on the customer's phone, so a reinstall
     wiped it with no record anywhere and staff took the complaint with nothing
     to look it up in. See server/petals/ledger.js and
     docs/PETALS-SERVER-SCOPE.md.

     Identity is name AND phone, with no SMS — Clover messaging answers 405 and
     Twilio is not being added. That is a speed bump against strangers, not
     authentication: anyone who knows the customer has both, and the kitchen
     ticket prints both by design. The blast radius is one reward, collected in
     person from a member of staff. Said plainly in the scope doc rather than
     dressed up as security.
     ============================================================================ */

  /** 503 when Petals are not configured, so the app can say "unavailable". */
  const needPetals = (_req, res, next) =>
    petals ? next() : res.status(503).json({
      error: "Rewards aren't available right now.",
      code: "PETALS_UNAVAILABLE",
    });

  const petalsFail = (res, e) => {
    if (e?.name === "PetalsError") {
      const status = e.code === "INSUFFICIENT_PETALS" ? 409 : 400;
      return res.status(status).json({ error: e.message, code: e.code, ...(
        e.available === undefined ? {} : { available: e.available, needed: e.needed }
      ) });
    }
    return fail(res, e);
  };

  /* POST, not GET: it carries a phone number, which has no business in a URL,
     an access log or a proxy cache. */
  app.post("/api/clover/petals/balance", needPetals, async (req, res) => {
    try {
      const { name, phone } = req.body ?? {};
      res.json(await petals.balance({ name, phone }));
    } catch (e) { petalsFail(res, e); }
  });

  /* Bind a phone to a balance, and carry a device balance across exactly once.
     `deviceBalance` exists only for the migration off device-only storage; the
     unique key behind it means a retry cannot double it. */
  app.post("/api/clover/petals/claim", needPetals, async (req, res) => {
    try {
      const { name, phone, deviceBalance } = req.body ?? {};
      res.json(await petals.claim({ name, phone, deviceBalance }));
    } catch (e) { petalsFail(res, e); }
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
  /* Settling a reservation is a SIDE EFFECT of answering this question, and
     that is deliberate. This endpoint is the only place that learns a payment
     happened — the tracking screen polls it and the launch sweep asks it — so
     hanging the settle/release off the answer means both paths drive it and
     neither needs to remember to. Every write is keyed on the order, so being
     asked ten times settles once.

     Failures here are swallowed: a customer must never be told their order
     status is unknown because a ledger write had a bad minute. The next poll,
     or the next launch, tries again. */
  const settleReservation = async (orderId, status) => {
    if (!petals) return;
    try {
      if (status.paid && !status.voided) await petals.settle(orderId);
      else if (status.voided) await petals.release(orderId);
    } catch (e) {
      console.warn(`  order ${orderId}: Petals not settled (${e?.message ?? "unknown"})`);
    }
  };

  app.get("/api/clover/orders/:orderId/status", requireConfig, async (req, res) => {
    try {
      const o = await clover.getOrder(req.params.orderId);
      const status = paymentStatus(o);
      await settleReservation(o.id ?? req.params.orderId, status);
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
        /* A deleted order is a void, so the held Petals go back. The customer
           lost the food; they must not also lose the reward. */
        await settleReservation(req.params.orderId, { paid: false, voided: true });
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
