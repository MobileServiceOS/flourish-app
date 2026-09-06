/* React glue for the Clover proxy. Each hook is defensive by default: if the
   proxy isn't running the app keeps working as a menu, it just can't take an
   order. Nothing here holds a secret. */
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { health, getInventory, getOrder, quoteOrder } from "../lib/clover.js";
import { trackingStage } from "../lib/cloverOrder.js";

/**
 * Is ordering connected?
 *   loading  — still asking
 *   online   — proxy up and Clover configured; ordering works
 *   preview  — proxy down or unconfigured; browse only
 */
export function useCloverHealth() {
  const [state, setState] = useState({ status: "loading", sandbox: false, reason: null });

  const check = useCallback(async () => {
    const h = await health();
    setState({
      status: h.online && h.configured ? "online" : "preview",
      sandbox: h.sandbox,
      // Distinguishes "server not started" from "server up, credentials
      // rejected" — the fix is completely different for each.
      reason: h.reason,
    });
  }, []);

  useEffect(() => { check(); }, [check]);
  return { ...state, recheck: check };
}

/**
 * Sold-out state, merged from two sources:
 *   - Clover stockCount hitting 0
 *   - the manual 86 toggle, which always wins so staff can pull something
 *     before the count runs down
 * Polls every `intervalMs`; a failed poll keeps the last good answer rather
 * than flickering the whole menu back in stock.
 */
export function useInventorySync({ enabled = true, intervalMs = 60_000 } = {}) {
  const [fromClover, setFromClover] = useState(() => new Set());
  const [manual, setManual] = useState(() => new Set());
  const [lastSync, setLastSync] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const ctrl = new AbortController();

    const pull = async () => {
      try {
        const { items } = await getInventory(ctrl.signal);
        if (!alive) return;
        setFromClover(new Set(items.filter((i) => !i.available).map((i) => i.id)));
        setLastSync(new Date());
        setError(null);
      } catch (e) {
        if (!alive || e.name === "AbortError") return;
        setError(e.message);   // keep the previous set; a blip must not un-86 the menu
      }
    };

    pull();
    const t = setInterval(pull, intervalMs);
    return () => { alive = false; ctrl.abort(); clearInterval(t); };
  }, [enabled, intervalMs]);

  const toggleManual = useCallback((id) => {
    setManual((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }, []);

  const soldOut = new Set([...fromClover, ...manual]);
  return { soldOut, fromClover, manual, toggleManual, lastSync, error };
}

/**
 * Real order status, replacing the old setTimeout simulation.
 * Stops once the order is ready or after `maxMs`, so a forgotten tab doesn't
 * poll the register all night.
 */
export function useOrderStatus(cloverOrderId, { intervalMs = 15_000, maxMs = 30 * 60_000, enabled = true } = {}) {
  const [stage, setStage] = useState(0);
  const [error, setError] = useState(null);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    if (!enabled || !cloverOrderId) return;
    let alive = true;
    const ctrl = new AbortController();
    startedAt.current = Date.now();

    const tick = async () => {
      if (!alive) return;
      if (Date.now() - startedAt.current > maxMs) { clearInterval(t); return; }
      try {
        const o = await getOrder(cloverOrderId, ctrl.signal);
        if (!alive) return;
        const s = trackingStage(o);
        setStage(s);
        setError(null);
        if (s >= 2) clearInterval(t);
      } catch (e) {
        if (!alive || e.name === "AbortError") return;
        setError(e.message);
      }
    };

    tick();
    const t = setInterval(tick, intervalMs);
    return () => { alive = false; ctrl.abort(); clearInterval(t); };
  }, [cloverOrderId, intervalMs, maxMs, enabled]);

  return { stage, error };
}

/**
 * When the kitchen could have this cart ready.
 *
 * The window is the SERVER's answer, always. Prep time depends on what was
 * ordered — fish and seafood are cooked to order and cannot be promised in
 * fifteen minutes — and the server is the only side that also knows when the
 * door shuts. Nothing here recomputes it; a null quote means "we do not know
 * yet", and the screens say so rather than inventing a number.
 *
 * Re-asked when the cart changes and on a minute tick, because a customer can
 * sit on the cart screen long enough for the window to move — or for the
 * kitchen to run out of time to cook what is in it.
 */
export function useReadyQuote(cart, { enabled = true, intervalMs = 60_000 } = {}) {
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState(null);

  // The cart's identity changes on every render; its *contents* are what move
  // the window, so key the effect on those.
  const key = useMemo(
    () => cart.map((l) => `${l.itemId}x${l.qty}`).join("|"),
    [cart]
  );

  useEffect(() => {
    if (!enabled || !cart.length) { setQuote(null); setError(null); return; }
    let alive = true;
    const ctrl = new AbortController();

    const ask = async () => {
      try {
        const q = await quoteOrder(cart, ctrl.signal);
        if (alive) { setQuote(q); setError(null); }
      } catch (e) {
        // Keep the last good window rather than blanking it — a dropped poll
        // is not news the customer needs.
        if (alive) setError(e.message);
      }
    };

    ask();
    const t = setInterval(ask, intervalMs);
    return () => { alive = false; ctrl.abort(); clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, intervalMs]);

  return { quote, error };
}
