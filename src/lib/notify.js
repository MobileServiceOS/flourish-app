/* Order-ready alerts.

   Stage 1: a LOCAL notification scheduled on the device for the estimated ready
   time. No server, no device tokens, no Apple Developer account, and nothing to
   pay per message — which is the whole reason for doing it this way rather than
   sending an SMS.

   Be honest about the limitation: this fires on a timer, not when the kitchen
   actually finishes. If the kitchen runs long the alert is early. Stage 2
   replaces the schedule with a real push the moment Clover flips the order to
   ready; this file is the seam that makes that swap small.

   Three environments to survive:
     native (Capacitor)  — the real thing, fires with the app closed
     browser             — Notification API + a timer, only while the tab lives
     neither / denied    — silently does nothing, the in-app status screen is
                           always there as the fallback */

const PLUGIN = "@capacitor/local-notifications";

/** Capacitor plugin if we're in a native shell, else null. Never throws. */
async function plugin() {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor?.isNativePlatform?.()) return null;
    const { LocalNotifications } = await import(/* @vite-ignore */ PLUGIN);
    return LocalNotifications ?? null;
  } catch {
    return null;
  }
}

/**
 * Where does this device stand on notifications?
 *   "granted" | "denied" | "prompt" | "unsupported"
 * "prompt" means we have not asked yet, which is the only state worth asking in.
 */
export async function permissionState() {
  const p = await plugin();
  if (p) {
    try {
      const { display } = await p.checkPermissions();
      return display === "prompt-with-rationale" ? "prompt" : display;
    } catch { return "unsupported"; }
  }
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission === "default" ? "prompt" : Notification.permission;
}

/**
 * Ask for permission. Only ever call this from somewhere the reason is obvious
 * — we ask on the confirmation screen, with food already on the way, rather
 * than cold at launch where it just gets denied.
 */
export async function requestPermission() {
  const p = await plugin();
  if (p) {
    try {
      const { display } = await p.requestPermissions();
      return display === "granted" ? "granted" : "denied";
    } catch { return "unsupported"; }
  }
  if (typeof Notification === "undefined") return "unsupported";
  try {
    const r = await Notification.requestPermission();
    return r === "default" ? "prompt" : r;
  } catch { return "unsupported"; }
}

/* Browser timers, so a cancelled order can clear its pending alert. */
const webTimers = new Map();

/** A stable 32-bit id per order — the native scheduler needs an integer. */
export function notificationId(orderNum) {
  let h = 0;
  for (const ch of String(orderNum)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h) % 2_147_483_647 || 1;
}

/**
 * Schedule "your order is ready" for `at`.
 * Returns true if something was actually scheduled.
 */
export async function scheduleOrderReady({ orderNum, at, itemCount = 0 }) {
  const when = at instanceof Date ? at : new Date(at);
  if (!(when instanceof Date) || Number.isNaN(when.getTime())) return false;
  // Already due, or in the past — nothing useful to schedule.
  if (when.getTime() - Date.now() < 5_000) return false;
  if ((await permissionState()) !== "granted") return false;

  const id = notificationId(orderNum);
  const title = "Your order is ready";
  const body = itemCount
    ? `Order ${orderNum} — ${itemCount} item${itemCount > 1 ? "s" : ""} ready at 4035 Laconia Ave.`
    : `Order ${orderNum} is ready at 4035 Laconia Ave.`;

  const p = await plugin();
  if (p) {
    try {
      await p.schedule({ notifications: [{ id, title, body, schedule: { at: when } }] });
      return true;
    } catch { return false; }
  }

  if (typeof Notification === "undefined") return false;
  clearTimeout(webTimers.get(id));
  webTimers.set(id, setTimeout(() => {
    try { new Notification(title, { body, tag: String(orderNum) }); } catch { /* tab gone */ }
    webTimers.delete(id);
  }, when.getTime() - Date.now()));
  return true;
}

/** Drop a scheduled alert — an order that got cancelled should not still ping. */
export async function cancelOrderReady(orderNum) {
  const id = notificationId(orderNum);
  const p = await plugin();
  if (p) {
    try { await p.cancel({ notifications: [{ id }] }); } catch { /* nothing pending */ }
    return;
  }
  clearTimeout(webTimers.get(id));
  webTimers.delete(id);
}

export const __clearWebTimers = () => {
  for (const t of webTimers.values()) clearTimeout(t);
  webTimers.clear();
};
