/* Browser-side Clover client.

   This file never sees CLOVER_PRIVATE_TOKEN. It talks to our own /api proxy,
   which holds the token. The only Clover credential that belongs in the bundle
   is VITE_CLOVER_PUBLIC_TOKEN, which can tokenize a card but cannot charge one.

   Everything here answers in one of three ways:
     ok         — it worked
     error      — Clover or the proxy said no, with a line a customer can read
     preview    — the proxy isn't running, so ordering is switched off rather
                  than the app crashing on a failed fetch */

export const PUBLIC_TOKEN = import.meta.env?.VITE_CLOVER_PUBLIC_TOKEN ?? "";
export const MERCHANT_ID = String(import.meta.env?.VITE_CLOVER_MERCHANT_ID ?? "")
  .replace(/^\/+|\/+$/g, "");

export const CLOVER_SDK_URL = "https://checkout.clover.com/sdk.js";

export class ApiError extends Error {
  constructor(message, { status = 0, code = null, declineReason = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.declineReason = declineReason;
  }
  /** True when nothing is listening — the proxy was never started. */
  get isOffline() { return this.code === "OFFLINE"; }
  get isPreview() { return this.code === "OFFLINE" || this.code === "NOT_CONFIGURED"; }
}

const OFFLINE_MSG = "App is in preview mode — ordering is not connected yet";

async function call(path, { method = "GET", body, signal } = {}) {
  let res;
  try {
    res = await fetch(`/api/clover${path}`, {
      method,
      signal,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    // fetch only rejects on a transport failure, which here means the proxy
    // isn't up. A customer should be told the app is in preview, not "failed to
    // fetch".
    throw new ApiError(OFFLINE_MSG, { code: "OFFLINE" });
  }

  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }

  if (!res.ok) {
    // Vite with no proxy target returns the index.html shell, which parses as
    // null — treat an unparseable non-JSON response as offline too.
    const code = data?.code ?? (data === null ? "OFFLINE" : null);
    throw new ApiError(
      code === "OFFLINE" ? OFFLINE_MSG : (data?.error || "Couldn't reach the kitchen — try again"),
      { status: res.status, code, declineReason: data?.declineReason ?? null }
    );
  }
  return data;
}

/** Is the proxy up and configured? Used to decide preview mode at launch. */
export async function health() {
  try {
    const h = await call("/health");
    return {
      online: true,
      configured: Boolean(h.configured),
      sandbox: Boolean(h.sandbox),
      reason: h.reason ?? null,
    };
  } catch {
    return { online: false, configured: false, sandbox: false, reason: "PROXY_DOWN" };
  }
}

export const getInventory = (signal) => call("/inventory", { signal });

export const setStock = (itemId, stockCount) =>
  call(`/inventory/${encodeURIComponent(itemId)}/stock`, { method: "POST", body: { stockCount } });

export const createOrder = (payload) => call("/orders", { method: "POST", body: payload });

export const getOrder = (orderId, signal) =>
  call(`/orders/${encodeURIComponent(orderId)}`, { signal });

export const pay = (payload) => call("/pay", { method: "POST", body: payload });

export const syncCustomer = (name, phone) =>
  call("/customers", { method: "POST", body: { name, phone } });

export const findCustomer = (phone) =>
  call(`/customers?phone=${encodeURIComponent(phone)}`);

/* ---------- hosted card iframe ----------
   Loaded on demand so the SDK isn't fetched by customers who never check out,
   and so a blocked script becomes a handled error rather than a blank screen. */
let sdkPromise = null;
export function loadCloverSdk(src = CLOVER_SDK_URL) {
  if (typeof document === "undefined") return Promise.reject(new ApiError("No DOM"));
  if (window.Clover) return Promise.resolve(window.Clover);
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => window.Clover
      ? resolve(window.Clover)
      : reject(new ApiError("Card form failed to load", { code: "SDK" }));
    s.onerror = () => {
      sdkPromise = null;
      reject(new ApiError("Card form failed to load. Check your connection.", { code: "SDK" }));
    };
    document.head.appendChild(s);
  });
  return sdkPromise;
}

export const __resetSdk = () => { sdkPromise = null; };
