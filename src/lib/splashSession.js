/* Has the launch animation already played?

   In memory, deliberately. This started out in sessionStorage on the assumption
   that it would be "gone the next time the app is opened cold" — which is true
   in a browser tab and FALSE in a WKWebView. Capacitor keeps the web view's
   data store across app launches, so the flag survived, and the splash played
   exactly once ever and never again on a real device.

   A module variable is the right lifetime for what this actually means:

     cold app launch  -> new JS context -> plays          (what we want)
     resume from lock -> same context   -> skipped        (what we want)
     browser reload   -> new context    -> plays          (fine; a reload is a
                                                           fresh visit)

   sessionStorage is still *read* as a deliberate override so the test suite can
   skip 2.5s of animation on every render, but the app never writes it. */

const OVERRIDE_KEY = "flourish:splash-seen";

let playedInThisContext = false;

/** Set only by the test setup, never by the app. */
function overridden() {
  try { return globalThis.sessionStorage?.getItem(OVERRIDE_KEY) === "1"; } catch { return false; }
}

export const splashSeen = () => playedInThisContext || overridden();

export function markSplashSeen() {
  playedInThisContext = true;
}

/** For tests that need the first-launch behaviour back. */
export const __resetSplashSeen = () => { playedInThisContext = false; };

/** How long the splash holds before it is allowed to leave. */
export const SPLASH_HOLD_MS = 2050;   // bloom finishes ~2.0s, then it fades out
export const SPLASH_FADE_MS = 450;    // ...landing on the app at ~2.5s
export const SPLASH_REDUCED_MS = 800; // prefers-reduced-motion: logo only

export function prefersReducedMotion() {
  try {
    return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  } catch { return false; }
}
