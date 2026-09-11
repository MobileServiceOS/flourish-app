/* Protecting the proxy once it is reachable from the internet.

   Be honest about what is and is not possible here. The client is a public app;
   anything shipped to it can be read out of the bundle in a minute. So the app
   key below is NOT a secret and does not authenticate anyone — it only stops
   drive-by scanners and casual curl abuse. The protections that actually hold
   are the ones that do not depend on the caller being honest:

     - a rate limit per IP, so nobody can hammer the register
     - an origin allowlist, which browsers enforce and cannot be spoofed by a
       page on another domain
     - a ceiling on what a single charge may be, so a tampered request cannot
       bill someone four figures
     - a body size cap, applied in app.js

   The one real secret, CLOVER_PRIVATE_TOKEN, never leaves the server at all.
   That is what keeps this safe, not the key. */

const clean = (v) => String(v ?? "").trim();

/* Read at request time, not at import time.
   As a module-level const this was a snapshot of whatever the environment
   happened to hold the moment guard.js was first imported — which made the
   test suite intermittently fail, because a worker that imported this while
   another file had APP_KEY set inherited that key and then rejected its own
   requests with 401. Reading per request is also the more honest behaviour on
   a server: the key in force is the one configured now, not the one that was
   configured at boot. */
export const appKey = () => clean(process.env.APP_KEY);
export const ALLOWED_ORIGINS = clean(process.env.ALLOWED_ORIGINS)
  .split(",").map((s) => s.trim()).filter(Boolean);

/** No single order should ever legitimately charge more than this. */
export const MAX_CHARGE_DOLLARS = Number(clean(process.env.MAX_CHARGE_DOLLARS)) || 500;

const LOCAL = /^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1|localhost)$/;
const isLocal = (req) => LOCAL.test(String(req.ip || req.socket?.remoteAddress || ""));

/* ---------- rate limit ----------
   Fixed window per IP. In memory, which is fine for one process; if the proxy
   is ever run behind more than one instance this needs to move to Redis or the
   limit becomes per-instance. */
const WINDOW_MS = 60_000;
const hits = new Map();

export function rateLimit({ max = 60, windowMs = WINDOW_MS } = {}) {
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.socket?.remoteAddress || "unknown";
    const entry = hits.get(key);

    if (!entry || now > entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      const retry = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retry));
      return res.status(429).json({
        error: "Too many requests — give it a moment and try again.",
        code: "RATE_LIMITED",
      });
    }
    next();
  };
}

/** Paying is far rarer than browsing, so it gets a tighter budget. */
export const payRateLimit = () => rateLimit({ max: 8 });

/* Stop the map growing without bound on a long-lived process. */
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
}, WINDOW_MS);
sweep.unref?.();

export const __resetRateLimit = () => hits.clear();

/* ---------- origin ----------

   The iOS app is not a web page: its web view loads from `capacitor://localhost`
   and sends that as its Origin. Those schemes are always allowed, because a page
   on a real website cannot forge them — a browser will not let evil.com claim to
   be `capacitor://localhost`, which is the whole reason the origin allowlist is
   worth anything. Leaving them out would 403 every customer on the App Store
   build while the web build carried on working. */
export const NATIVE_ORIGINS = ["capacitor://localhost", "ionic://localhost"];

export function checkOrigin(req, res, next) {
  const origin = req.get("origin");
  // Same-origin browser requests and some native requests send no Origin at all.
  if (!origin) return next();
  if (NATIVE_ORIGINS.includes(origin)) return next();
  if (!ALLOWED_ORIGINS.length) return next();           // not configured, dev
  if (ALLOWED_ORIGINS.includes(origin)) return next();
  return res.status(403).json({ error: "Origin not allowed", code: "BAD_ORIGIN" });
}

/* ---------- app key ---------- */
/* The middleware, parameterised by where the key comes from. The default reads
   the environment on every request (see appKey above); tests inject a fixed one
   so they never have to mutate process.env, which vitest shares across workers
   and which made an unrelated suite fail one run in nine. */
export function requireAppKeyWith(getKey) {
  return (req, res, next) => appKeyGuard(getKey(), req, res, next);
}

export function requireAppKey(req, res, next) {
  return appKeyGuard(appKey(), req, res, next);
}

function appKeyGuard(key, req, res, next) {
  // Unset means development. Localhost is let through so `npm run dev:all`
  // needs no ceremony; anything remote is refused outright rather than left
  // open, because an unauthenticated payment endpoint on the internet is the
  // failure mode this whole file exists to prevent.
  if (!key) {
    return isLocal(req)
      ? next()
      : res.status(503).json({
          error: "This server is not configured to accept remote requests.",
          code: "NO_APP_KEY",
        });
  }
  if (req.get("x-flourish-key") === key) return next();
  return res.status(401).json({ error: "Not authorised", code: "BAD_APP_KEY" });
}

/** Belt and braces on the charge amount, independent of anything the client says. */
export function capCharge(req, res, next) {
  const amount = Number(req.body?.amountDollars);
  const tip = Number(req.body?.tipDollars) || 0;
  if (amount + tip > MAX_CHARGE_DOLLARS) {
    return res.status(400).json({
      error: "That amount is above the limit for a single order. Call the restaurant.",
      code: "AMOUNT_TOO_LARGE",
    });
  }
  next();
}

export const describeGuard = () => ({
  appKey: appKey() ? "set" : "unset (localhost only)",
  origins: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS.join(", ") : "any (unset)",
  maxCharge: MAX_CHARGE_DOLLARS,
});
