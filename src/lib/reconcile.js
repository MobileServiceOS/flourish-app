/**
 * Which stored orders are worth asking Clover about on launch.
 *
 * The hole this closes: the app takes no money, so an order leaves here open
 * and owing and the Petals are credited only when Clover confirms the payment.
 * That confirmation arrives from a poll that runs on the tracking screen — and
 * only while that screen is open. The ordinary customer does not keep it open.
 * They order, put the phone away, drive over, pay at the counter, and the app
 * is not running when the one event it was waiting for happens. Their Petals
 * were earned and never credited.
 *
 * So on launch the app re-asks about the recent unpaid ones. Nothing here
 * awards anything: this picks the orders worth a request, and the caller runs
 * them through the same `awardPoints` guards as the live poll, so an order the
 * tracking screen already settled cannot be paid twice.
 */

/** How far back to look. A day covers "ordered last night, paid this morning". */
export const RECONCILE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * At most this many requests on a launch. A customer with a long history would
 * otherwise fire one per stored order at the exact moment the app is trying to
 * render its first screen, and the oldest of them are the least likely to have
 * just been paid.
 */
export const RECONCILE_MAX = 5;

/**
 * When an order was placed, as a timestamp, or NaN if it cannot be told.
 *
 * `placedAt` is stamped at creation. Orders stored before that field existed
 * fall back to `readyAt`, which is within about an hour of placement — close
 * enough for a 24-hour window and much better than dropping them, since the
 * customers holding those orders are exactly the ones whose Petals went
 * missing. `when` is deliberately not consulted: it is the string "Today",
 * frozen at creation, and by the next morning it is a lie.
 */
export function placedAtOf(order) {
  return Date.parse(order?.placedAt ?? order?.readyAt ?? "");
}

/**
 * The orders to check, newest first.
 *
 * Skipped, and why:
 *   - no `cloverOrderId` — there is nothing to ask Clover about
 *   - `pointsAwarded` — already credited; asking again wastes a request
 *   - `earnable <= 0` — a guest order earns nothing, so a confirmed payment
 *     would change no balance. The status is not worth a request on launch
 *   - no usable timestamp — an unbounded "unpaid forever" list would be
 *     re-checked on every launch for the life of the install
 *   - older than the window
 *
 * A timestamp in the future is kept: a scheduled order is placed before its
 * pickup window, and its readyAt fallback is legitimately ahead of now.
 */
export function ordersToReconcile(orders = [], now = Date.now()) {
  return (Array.isArray(orders) ? orders : [])
    .filter((o) => {
      if (!o || !o.cloverOrderId) return false;
      if (o.pointsAwarded) return false;
      if (!(Number(o.earnable) > 0)) return false;
      const t = placedAtOf(o);
      if (!Number.isFinite(t)) return false;
      return now - t <= RECONCILE_WINDOW_MS;
    })
    .sort((a, b) => placedAtOf(b) - placedAtOf(a))
    .slice(0, RECONCILE_MAX);
}
