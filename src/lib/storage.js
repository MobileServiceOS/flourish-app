/* Customer account persistence.
   Native (iOS/Android) uses Capacitor Preferences, which survives app updates.
   Browser dev falls back to localStorage so `npm run dev` works with no native build.
   Both are wrapped so a storage failure never takes the app down — a customer
   with a full disk or blocked storage should still be able to place an order. */

const KEY = "flourish:account";

let Preferences = null;
try {
  // Optional: only present once @capacitor/preferences is installed.
  ({ Preferences } = await import("@capacitor/preferences"));
} catch {
  Preferences = null;
}

async function readRaw() {
  if (Preferences) {
    const { value } = await Preferences.get({ key: KEY });
    return value ?? null;
  }
  return globalThis.localStorage?.getItem(KEY) ?? null;
}

async function writeRaw(value) {
  if (Preferences) {
    if (value === null) return Preferences.remove({ key: KEY });
    return Preferences.set({ key: KEY, value });
  }
  if (value === null) globalThis.localStorage?.removeItem(KEY);
  else globalThis.localStorage?.setItem(KEY, value);
}

export async function loadAccount() {
  try {
    const raw = await readRaw();
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // corrupt or unavailable: start signed out rather than crash
  }
}

export async function saveAccount(account) {
  try {
    await writeRaw(account === null ? null : JSON.stringify(account));
  } catch {
    /* non-fatal: the order still goes through, points sync next launch */
  }
}

/**
 * Erase the account and everything personal stored with it.
 *
 * Separate from saveAccount(null) on purpose. This is what a customer's
 * "Delete my account" taps into, so it is deliberate about being thorough:
 * both storage backends are cleared, not just the one currently in use. A
 * device that ran an older browser build has a copy under the same key in
 * localStorage; `readRaw` would never look at it once Preferences exists, but
 * it is still the customer's name and phone number sitting on their phone
 * after they asked for it to be gone.
 *
 * No network call, by design. The account only ever existed on this device, so
 * deleting it cannot fail because the kitchen is unreachable.
 *
 * Returns true when the data is gone.
 */
export async function deleteAccount() {
  let ok = true;
  try {
    await writeRaw(null);
  } catch { ok = false; }

  // Belt and braces: whichever backend was NOT used above.
  try { globalThis.localStorage?.removeItem(KEY); } catch { /* blocked storage */ }
  if (Preferences) {
    try { await Preferences.remove({ key: KEY }); } catch { /* already gone */ }
  }

  return ok;
}
