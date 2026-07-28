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
