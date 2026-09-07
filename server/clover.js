/* Server-side Clover client. The only place the private token is used.

   Every error that leaves this module has been through `scrub()`, because
   Clover echoes request context back in some error bodies and we must never
   relay a token into a log or an HTTP response. */
import {
  API_BASE, ECOMM_BASE, MERCHANT_ID, PRIVATE_TOKEN, CONFIGURED, PRINTER_UUID,
} from "./env.js";

export class CloverError extends Error {
  /* `url` is the resolved request URL. A bare "405 POST not allowed" with no
     URL is what made a wrong-path bug take three rounds to find: the status
     says the path is not routed, and the path is the one thing it omitted.
     It carries no token — those live in the Authorization header. */
  constructor(status, message, body, url = null) {
    super(message);
    this.name = "CloverError";
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

/** Remove anything token-shaped from a string before it can be logged. */
const scrub = (s) => {
  let out = String(s ?? "");
  if (PRIVATE_TOKEN) out = out.split(PRIVATE_TOKEN).join("«redacted»");
  return out.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer «redacted»");
};

/** Turn a Clover error body into something a customer could read. */
export function humanise(status, body) {
  const raw = body?.message || body?.error?.message || body?.error || "";
  const msg = scrub(raw);
  if (status === 401 || status === 403) {
    return "The restaurant's payment system rejected our credentials. Staff have been notified.";
  }
  if (status === 404) return "That item is no longer on the register.";
  if (status === 429) return "The kitchen system is busy. Try again in a moment.";
  if (status >= 500) return "The restaurant's system is having trouble. Try again shortly.";
  if (/insufficient|declin/i.test(msg)) return msg || "Card declined.";
  return msg || "Something went wrong talking to the register.";
}

async function request(base, path, { method = "GET", body, timeoutMs = 15_000 } = {}) {
  const url = `${base}${path}`;
  if (!CONFIGURED) {
    throw new CloverError(503, "Clover is not configured on this server", { code: "NOT_CONFIGURED" }, url);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method,
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${PRIVATE_TOKEN}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (e) {
    clearTimeout(timer);
    const aborted = e.name === "AbortError";
    throw new CloverError(504, aborted ? "Clover timed out" : scrub(e.message), { code: "NETWORK" }, url);
  }
  clearTimeout(timer);

  let payload = null;
  const text = await res.text();
  if (text) { try { payload = JSON.parse(text); } catch { payload = { message: scrub(text).slice(0, 400) }; } }

  if (!res.ok) throw new CloverError(res.status, humanise(res.status, payload), payload, url);
  return payload;
}

const m = (path) => `/v3/merchants/${MERCHANT_ID}${path}`;

/* The one URL this whole file exists to get right. Exported so a test can
   assert it character for character against the request that is known to
   print, rather than trusting that a template literal still reads correctly. */
export const PRINT_EVENT_PATH = m("/print_event");
export const printEventUrl = () => `${API_BASE}${PRINT_EVENT_PATH}`;

/** Exactly what will be POSTed, so it can be logged and asserted on. */
export const printEventBody = (orderId, printerId) =>
  ({ orderRef: { id: orderId }, printer: { id: printerId } });

export const api = {
  merchant: () => request(API_BASE, m("")),

  /* Inventory. expand=modifierGroups so one call gives both stock levels and
     the modifier ids the order builder needs. */
  items: () =>
    request(API_BASE, m("/items?limit=1000&expand=modifierGroups,categories")),

  modifierGroups: () =>
    request(API_BASE, m("/modifier_groups?limit=200&expand=modifiers")),

  setStock: (itemId, stockCount) =>
    request(API_BASE, m(`/items/${itemId}`), { method: "POST", body: { stockCount } }),

  createOrder: (orderCartBody) =>
    request(API_BASE, m("/atomic_order/orders"), { method: "POST", body: orderCartBody }),

  /* expand=payments so payment state can be worked out from the payments
     themselves, not just the summary field — a partially-paid order reports
     paymentState OPEN while carrying real money. */
  getOrder: (orderId) =>
    request(API_BASE, m(`/orders/${orderId}?expand=payments,lineItems`)),

  /* Clover's own loyalty programme, when the merchant has one. Both of these
     404/405 on a merchant without loyalty enabled, which is not an error — see
     loyaltyConfig() below. */
  loyaltyProgram: () => request(API_BASE, m("/loyalty/program")),
  loyaltyTiers: () => request(API_BASE, m("/loyalty/tiers")),

  /** Every printer the merchant has. Station built-ins report type MY_LOCAL. */
  printers: () => request(API_BASE, m("/printers")),

  /* print_event is MERCHANT-scoped, not order-scoped. The order is named by
     `orderRef` in the BODY, and the path carries no order id at all:

         POST /v3/merchants/{mId}/print_event

     This was `/v3/merchants/{mId}/orders/{orderId}/print_event`, which Clover
     does not route — and an unrouted path answers `405 POST not allowed`, the
     same thing it says for a made-up endpoint. So printer discovery worked,
     the printer was chosen correctly, the body was right, and every ticket
     still 405'd. See PRINT_EVENT_PATH and the test that pins it. */
  printEvent: (orderId, printerId) =>
    request(API_BASE, PRINT_EVENT_PATH, {
      method: "POST",
      body: { orderRef: { id: orderId }, printer: { id: printerId } },
    }),

  findCustomerByPhone: (phone) =>
    request(API_BASE, m(`/customers?filter=phoneNumber=${encodeURIComponent(phone)}&limit=1`)),

  createCustomer: ({ firstName, lastName, phone }) =>
    request(API_BASE, m("/customers"), {
      method: "POST",
      body: {
        firstName, lastName,
        phoneNumbers: phone ? [{ phoneNumber: phone }] : undefined,
      },
    }),

  /** Put the customer on the order so the merchant's reports see them. */
  attachCustomer: (orderId, customerId) =>
    request(API_BASE, m(`/orders/${orderId}`), {
      method: "POST", body: { customers: [{ id: customerId }] },
    }),

  /* Clover's own customer messaging. Not on every plan and not on every
     merchant, so every caller treats a failure here as cosmetic. */
  sendOrderMessage: (orderId, message) =>
    request(API_BASE, m(`/orders/${orderId}/messages`), {
      method: "POST", body: { message },
    }),

  /** Staff tapping "ready" — flips the order and lets the customer know. */
  fulfillOrder: (orderId) =>
    request(API_BASE, m(`/orders/${orderId}`), {
      method: "POST", body: { state: "fulfilled" },
    }),

  /* Ecommerce charge — different host, same private token. */
  charge: (payment) => request(ECOMM_BASE, "/v1/charges", { method: "POST", body: payment }),
};

/**
 * gid -> { modifierName -> { id, price } }
 * Cached because it changes rarely and the order path cannot afford a second
 * round trip. Prices come back in cents and are converted to dollars so the
 * catalog speaks the same units as the rest of the app.
 */
let catalogCache = { at: 0, value: null };
export const CATALOG_TTL_MS = 5 * 60_000;

export async function modifierCatalog({ force = false, now = Date.now() } = {}) {
  if (!force && catalogCache.value && now - catalogCache.at < CATALOG_TTL_MS) {
    return catalogCache.value;
  }
  const res = await api.modifierGroups();
  const catalog = {};
  for (const g of res?.elements ?? []) {
    const byName = {};
    for (const mod of g.modifiers?.elements ?? []) {
      byName[mod.name] = { id: mod.id, price: (mod.price ?? 0) / 100 };
    }
    catalog[g.id] = byName;
  }
  catalogCache = { at: now, value: catalog };
  return catalog;
}

export const __resetCatalog = () => { catalogCache = { at: 0, value: null }; };

/* ============================================================================
   PRINTERS

   The bug this section exists to fix: the proxy used to POST a print_event that
   named no printer at all, and Clover routed it nowhere. Meanwhile the only
   printer this merchant has reports type "MY_LOCAL" — the Station's built-in
   roll — which any list of "real" printer types leaves out.

   So the selection order below ends in a fallback that cannot fail: **if the
   merchant has any printer at all, one of them is chosen.** Preferring an order
   or kitchen printer is an optimisation; never returning null when the list is
   non-empty is the actual fix. A ticket on the wrong roll is a nuisance. A
   ticket on no roll is an order the kitchen never sees.
   ============================================================================ */

/* Most-wanted first. Anything not on this list still gets picked by the final
   fallback, so a printer type Clover invents next year is not a dead end. */
export const PRINTER_TYPE_ORDER = ["order", "kitchen", "fiscal", "receipt", "MY_LOCAL"];

/**
 * Choose one printer from the merchant's list.
 *
 * Returns null ONLY when the list is genuinely empty — that is the one case
 * nothing can be printed, and the caller says so loudly.
 */
export function selectPrinter(printers = [], envUuid = PRINTER_UUID) {
  const list = (printers ?? []).filter((p) => p && (p.uuid || p.id));
  if (!list.length) return null;

  const uuidOf = (p) => p.uuid || p.id;

  // An explicit CLOVER_PRINTER_UUID is a decision someone made on purpose.
  if (envUuid) {
    const pinned = list.find((p) => uuidOf(p) === envUuid);
    if (pinned) return pinned;
    // Configured but absent: worth saying out loud, then fall through rather
    // than refusing to print at all.
    console.warn(`  printer: CLOVER_PRINTER_UUID ${envUuid} is not in the merchant's printer list`);
  }

  for (const type of PRINTER_TYPE_ORDER) {
    const hit = list.find((p) => String(p.type ?? "").toLowerCase() === type.toLowerCase());
    if (hit) return hit;
  }

  // Unknown type, or no type at all. Still a printer.
  return list[0];
}

/** Printer list, cached — it changes when hardware changes, which is rarely. */
let printerCache = { at: 0, list: null, chosen: null };
export const PRINTER_TTL_MS = 10 * 60_000;

export async function resolvePrinter({ force = false, now = Date.now(), client = api } = {}) {
  if (!force && printerCache.list && now - printerCache.at < PRINTER_TTL_MS) {
    return { printer: printerCache.chosen, printers: printerCache.list };
  }
  const res = await client.printers();
  const list = res?.elements ?? (Array.isArray(res) ? res : []);
  const chosen = selectPrinter(list);
  printerCache = { at: now, list, chosen };
  if (!list.length) {
    console.error(
      "  printer: Clover reports NO printers for this merchant. Kitchen tickets " +
      "cannot be printed — staff must work from the register screen. Pair a " +
      "printer in the Clover dashboard, or set CLOVER_PRINTER_UUID."
    );
  }
  return { printer: chosen, printers: list };
}

export const describePrinter = (p) =>
  p ? { uuid: p.uuid || p.id, name: p.name ?? null, type: p.type ?? null } : null;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** How long to hold off before the one retry. */
export const PRINT_RETRY_MS = 2_000;

/**
 * Print a kitchen ticket. Best effort by contract — the caller must not lose an
 * order because a roll of paper jammed — but it tries properly first:
 *
 *   - one retry after 2s, because a Station that is briefly busy is the common
 *     failure and a second attempt usually lands
 *   - on a 404 the cached printer is stale (unpaired, replaced, renamed), so the
 *     list is re-fetched and the new choice tried once
 *
 * Never throws. Returns what actually happened so the confirmation screen can
 * tell the customer the truth instead of guessing.
 */
export async function printOrderTicket(orderId, { client = api, sleep = wait } = {}) {
  const url = printEventUrl();

  /* Every failure carries the URL that failed, next to the status. Declared
     first because the printer lookup below can fail before anything else has
     run. */
  const failed = (p, e) => ({
    printed: false,
    printer: describePrinter(p),
    printError: printMessage(e),
    status: e?.status ?? null,
    url: e?.url ?? url,
  });

  const noPrinter = (status = null) => ({
    printed: false, printer: null,
    printError: "No printer is paired with this merchant",
    status, url,
  });

  let printer;
  try {
    ({ printer } = await resolvePrinter({ client }));
  } catch (e) {
    return failed(null, e);
  }
  if (!printer) return noPrinter();

  const attempt = async (p) => {
    const printerId = p.uuid || p.id;
    /* Say exactly what is about to go on the wire. The token is not here — it
       rides in the Authorization header — so this is safe to log, and it is
       what turns "405 POST not allowed" from a riddle into a one-line fix. */
    console.log(
      `  print: POST ${url} ` +
      `body=${JSON.stringify(printEventBody(orderId, printerId))}`
    );
    await client.printEvent(orderId, printerId);
    return { printed: true, printer: describePrinter(p), printError: null, status: 200, url };
  };

  try {
    return await attempt(printer);
  } catch (first) {
    /* A 404 means this printer is not there any more, so waiting will not help —
       re-read the list and try whatever replaced it. */
    if (first?.status === 404) {
      try {
        const { printer: fresh } = await resolvePrinter({ force: true, client });
        if (fresh) return await attempt(fresh);
        return noPrinter(404);
      } catch (e) {
        return failed(printer, e);
      }
    }

    await sleep(PRINT_RETRY_MS);
    try {
      return await attempt(printer);
    } catch (second) {
      return failed(printer, second);
    }
  }
}

/* Print failures are shown to staff, not customers, so the Clover message is
   useful — but it still goes through scrub() before it can reach a log. */
const printMessage = (e) => scrub(e?.message || "Print failed").slice(0, 200);

export const __resetPrinters = () => { printerCache = { at: 0, list: null, chosen: null }; };

/* ============================================================================
   PAYMENT STATE

   The app takes no money: an order is pushed to Clover open and owing, and the
   customer pays at the register. So "has this been paid?" is a question only
   Clover can answer, and it is the question loyalty points hang on.

   Read from two places and trust either, because they disagree in normal
   operation: `paymentState` is a summary Clover sets, and `payments` is what
   actually happened. A split payment leaves paymentState OPEN while real money
   has been taken, so summing the payments is what catches "paid in full".
   ============================================================================ */

/** Cents actually taken against this order, refunds subtracted. */
export function amountPaid(order) {
  const payments = order?.payments?.elements ?? order?.payments ?? [];
  if (!Array.isArray(payments)) return 0;
  return payments.reduce((sum, p) => {
    // A voided or failed payment is not money.
    const result = String(p?.result ?? "SUCCESS").toUpperCase();
    if (result && result !== "SUCCESS" && result !== "APPROVED") return sum;
    const refunded = (p?.refunds?.elements ?? p?.refunds ?? [])
      .reduce((r, x) => r + (Number(x?.amount) || 0), 0);
    return sum + (Number(p?.amount) || 0) - refunded;
  }, 0);
}

/**
 * Has this order been paid for?
 *
 * Deliberately strict: points are only ever awarded on a yes, so a wrong yes
 * gives away points for food nobody paid for. A wrong no just means the
 * customer keeps waiting on a screen, which the next poll fixes.
 */
export function paymentStatus(order) {
  const state = String(order?.state ?? "").toLowerCase();
  const paymentState = String(order?.paymentState ?? "").toUpperCase();
  const total = Number(order?.total) || 0;
  const paid = amountPaid(order);

  /* A deleted order is gone — voided at the register, or a mistake someone
     backed out of. No points, and stop asking. */
  const voided = Boolean(order?.deletedTime) || state === "deleted";

  const isPaid = !voided && (
    paymentState === "PAID"
    // Only count a payment sum when there is a total to compare it against;
    // total 0 with no payments must never read as "paid in full".
    || (total > 0 && paid >= total)
  );

  return {
    paid: isPaid,
    voided,
    refunded: paymentState === "REFUNDED",
    paymentState: order?.paymentState ?? null,
    state: order?.state ?? null,
    total,
    amountPaid: paid,
  };
}

/* ============================================================================
   CLOVER LOYALTY

   If the merchant runs Clover's own loyalty programme, its rules are the ones
   that count and ours would be a second, disagreeing scheme. So this asks.

   A merchant WITHOUT loyalty is the normal case, not an error. Clover answers
   an unrouted path with `405 GET not allowed` — the same thing it says for a
   made-up endpoint — so 404 and 405 both mean "no programme here", and the app
   quietly keeps its own scheme. Probed against this merchant: 405 on every
   loyalty path, identical to a nonsense path, so Flourish has none today.
   ============================================================================ */
let loyaltyCache = { at: 0, value: null };
export const LOYALTY_TTL_MS = 30 * 60_000;

const NOT_CONFIGURED = new Set([404, 405, 401, 403, 501]);

export async function loyaltyConfig({ force = false, now = Date.now(), client = api } = {}) {
  if (!force && loyaltyCache.value && now - loyaltyCache.at < LOYALTY_TTL_MS) {
    return loyaltyCache.value;
  }

  let value;
  try {
    const program = await client.loyaltyProgram();
    // An empty body is Clover saying "routed, but nothing configured".
    if (!program || (typeof program === "object" && !Object.keys(program).length)) {
      value = { configured: false, reason: "NO_PROGRAM", program: null, tiers: [] };
    } else {
      let tiers = [];
      try {
        const t = await client.loyaltyTiers();
        tiers = t?.elements ?? (Array.isArray(t) ? t : []);
      } catch { /* a programme without tiers is still a programme */ }
      value = { configured: true, reason: null, program, tiers };
    }
  } catch (e) {
    const status = e?.status ?? 0;
    value = {
      configured: false,
      // Worth telling apart: "this merchant has no loyalty" from "we could not
      // ask". Only the second is worth anybody's attention.
      reason: NOT_CONFIGURED.has(status) ? "NO_PROGRAM" : "LOOKUP_FAILED",
      program: null,
      tiers: [],
    };
  }

  loyaltyCache = { at: now, value };
  return value;
}

export const __resetLoyalty = () => { loyaltyCache = { at: 0, value: null }; };

/* ============================================================================
   CUSTOMER MESSAGING — DETECTED ONCE, THEN LEFT ALONE

   Clover's order messaging is not on this merchant's plan. Every attempt
   answers `405 POST not allowed`, which is what Clover says for a path it does
   not route at all — the same answer a made-up endpoint gets.

   That produced a warning on EVERY order, for a feature that is never coming
   back within a session. So it is probed once and then skipped: no attempt, no
   log, no error handling shared with printing. Printing and messaging failed
   with the identical status code for completely unrelated reasons, and sharing
   a code path is how one got mistaken for the other.

   The probe POSTs to the messages path with a sentinel order id:
     405 / 501  -> the path is not routed: the feature is absent
     404 / 400  -> routed, and it simply did not like the sentinel: available
   ============================================================================ */
export const MESSAGING_PROBE_ORDER = "__flourish_probe__";

let messaging = { state: "unknown", reason: null };

export const messagingState = () => messaging.state;

/** Announce it once. Called again, it says nothing. */
function noteMessagingUnavailable(reason) {
  if (messaging.state === "unavailable") return;
  messaging = { state: "unavailable", reason };
  console.log(
    `  Messaging  not available on this merchant's Clover plan (${reason}). ` +
    "Order confirmations will not be sent; the app never promised a text."
  );
}

export async function probeMessaging({ client = api } = {}) {
  if (messaging.state !== "unknown") return messaging.state;
  try {
    await client.sendOrderMessage(MESSAGING_PROBE_ORDER, "probe");
    // Routed and it accepted a sentinel: available, oddly, but available.
    messaging = { state: "available", reason: null };
  } catch (e) {
    const status = e?.status ?? 0;
    if (status === 405 || status === 501) noteMessagingUnavailable(`HTTP ${status}`);
    // Any other status means the path IS routed and merely rejected the
    // sentinel order, which is the answer we wanted.
    else messaging = { state: "available", reason: null };
  }
  return messaging.state;
}

/**
 * Send a confirmation, unless we already know this merchant cannot.
 * Returns whether it went. Never throws — and never shares a code path with
 * printing.
 */
export async function sendCustomerMessage(orderId, message, { client = api } = {}) {
  if (messaging.state === "unavailable") return false;
  try {
    await client.sendOrderMessage(orderId, message);
    messaging = { state: "available", reason: null };
    return true;
  } catch (e) {
    const status = e?.status ?? 0;
    // First real 405 is the detection, if the startup probe never ran.
    if (status === 405 || status === 501) noteMessagingUnavailable(`HTTP ${status}`);
    return false;
  }
}

export const __resetMessaging = () => { messaging = { state: "unknown", reason: null }; };
export { scrub as __scrub };
