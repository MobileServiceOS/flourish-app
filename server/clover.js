/* Server-side Clover client. The only place the private token is used.

   Every error that leaves this module has been through `scrub()`, because
   Clover echoes request context back in some error bodies and we must never
   relay a token into a log or an HTTP response. */
import {
  API_BASE, ECOMM_BASE, MERCHANT_ID, PRIVATE_TOKEN, CONFIGURED, PRINTER_UUID,
} from "./env.js";

export class CloverError extends Error {
  constructor(status, message, body) {
    super(message);
    this.name = "CloverError";
    this.status = status;
    this.body = body;
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
  if (!CONFIGURED) {
    throw new CloverError(503, "Clover is not configured on this server", { code: "NOT_CONFIGURED" });
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${base}${path}`, {
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
    throw new CloverError(504, aborted ? "Clover timed out" : scrub(e.message), { code: "NETWORK" });
  }
  clearTimeout(timer);

  let payload = null;
  const text = await res.text();
  if (text) { try { payload = JSON.parse(text); } catch { payload = { message: scrub(text).slice(0, 400) }; } }

  if (!res.ok) throw new CloverError(res.status, humanise(res.status, payload), payload);
  return payload;
}

const m = (path) => `/v3/merchants/${MERCHANT_ID}${path}`;

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

  getOrder: (orderId) => request(API_BASE, m(`/orders/${orderId}`)),

  /** Every printer the merchant has. Station built-ins report type MY_LOCAL. */
  printers: () => request(API_BASE, m("/printers")),

  /* A print_event with no printer names none, and Clover routes it nowhere.
     The printer id is the whole point of this call. */
  printEvent: (orderId, printerId) =>
    request(API_BASE, m(`/orders/${orderId}/print_event`), {
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
  let printer;
  try {
    ({ printer } = await resolvePrinter({ client }));
  } catch (e) {
    return { printed: false, printer: null, printError: printMessage(e) };
  }
  if (!printer) {
    return { printed: false, printer: null, printError: "No printer is paired with this merchant" };
  }

  const attempt = async (p) => {
    await client.printEvent(orderId, p.uuid || p.id);
    return { printed: true, printer: describePrinter(p), printError: null };
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
        return { printed: false, printer: null, printError: "No printer is paired with this merchant" };
      } catch (e) {
        return { printed: false, printer: describePrinter(printer), printError: printMessage(e) };
      }
    }

    await sleep(PRINT_RETRY_MS);
    try {
      return await attempt(printer);
    } catch (second) {
      return { printed: false, printer: describePrinter(printer), printError: printMessage(second) };
    }
  }
}

/* Print failures are shown to staff, not customers, so the Clover message is
   useful — but it still goes through scrub() before it can reach a log. */
const printMessage = (e) => scrub(e?.message || "Print failed").slice(0, 200);

export const __resetPrinters = () => { printerCache = { at: 0, list: null, chosen: null }; };
export { scrub as __scrub };
