/* Has the launch animation already played this session?

   sessionStorage rather than a module variable, so it survives a reload inside
   the same tab but is gone the next time the app is opened cold. A customer
   should see the bloom once when they pick the app up, not every time they
   come back from the lock screen.

   Wrapped because Safari private browsing throws on sessionStorage — a storage
   failure should cost you an animation, never the app. */

const KEY = "flourish:splash-seen";

export function splashSeen() {
  try { return globalThis.sessionStorage?.getItem(KEY) === "1"; } catch { return false; }
}

export function markSplashSeen() {
  try { globalThis.sessionStorage?.setItem(KEY, "1"); } catch { /* not fatal */ }
}

/** How long the splash holds before it is allowed to leave. */
export const SPLASH_HOLD_MS = 2050;   // bloom finishes ~2.0s, then it fades out
export const SPLASH_FADE_MS = 450;    // ...landing on the app at ~2.5s
export const SPLASH_REDUCED_MS = 800; // prefers-reduced-motion: wordmark only

export function prefersReducedMotion() {
  try {
    return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  } catch { return false; }
}
