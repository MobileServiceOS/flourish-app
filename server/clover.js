/* Server-side Clover client. The only place the private token is used.

   Every error that leaves this module has been through `scrub()`, because
   Clover echoes request context back in some error bodies and we must never
   relay a token into a log or an HTTP response. */
import {
  API_BASE, ECOMM_BASE, MERCHANT_ID, PRIVATE_TOKEN, CONFIGURED,
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

  printOrder: (orderId) =>
    request(API_BASE, m(`/orders/${orderId}/print_event`), { method: "POST", body: { orderRef: { id: orderId } } }),

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
export { scrub as __scrub };
