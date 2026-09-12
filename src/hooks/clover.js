/* React glue for the Clover proxy. Each hook is defensive by default: if the
   proxy isn't running the app keeps working as a menu, it just can't take an
   order. Nothing here holds a secret. */
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  health, getInventory, getOrder, quoteOrder, getOrderStatus, getLoyalty,
} from "../lib/clover.js";
import { trackingStage } from "../lib/cloverOrder.js";
import { ordersToReconcile } from "../lib/reconcile.js";
import { getPetalsBalance, claimPetals } from "../lib/clover.js";

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

/**
 * Poll Clover for whether this order has actually been paid for.
 *
 * Loyalty points are awarded HERE and nowhere else. When the order is placed
 * the customer owes for food they have not paid for and might never collect,
 * so awarding then gives points away for nothing. The register is the only
 * thing that knows, so the app asks it every thirty seconds.
 *
 * Polling stops the moment the answer is final — paid, or voided at the
 * register — because there is nothing further to learn and a phone left on a
 * confirmation screen should not sit there asking all afternoon. It also stops
 * at `maxMs`, for a customer who never came back for their food.
 *
 * This is not the only place a payment can be noticed any more. Closing the
 * app before paying used to mean the Petals were never credited at all; the
 * launch sweep in `useReconcileOnLaunch` picks those up the next time the app
 * opens. This hook is the live path, that one is the catch-up, and they share
 * the award guards so an order settled by both is credited once.
 */
export function useOrderPayment(cloverOrderId, {
  intervalMs = 30_000,
  maxMs = 2 * 60 * 60_000,
  enabled = true,
} = {}) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    if (!enabled || !cloverOrderId) return;
    let alive = true;
    const ctrl = new AbortController();
    startedAt.current = Date.now();

    let timer = null;
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };

    const tick = async () => {
      if (!alive) return;
      if (Date.now() - startedAt.current > maxMs) { stop(); return; }
      try {
        const s = await getOrderStatus(cloverOrderId, ctrl.signal);
        if (!alive) return;
        setStatus(s);
        setError(null);
        // Paid or voided: the answer cannot change in a way we care about.
        if (s.settled) stop();
      } catch (e) {
        if (!alive || e.name === "AbortError") return;
        // Keep polling through a blip — a dropped request is not an answer.
        setError(e.message);
      }
    };

    tick();
    timer = setInterval(tick, intervalMs);
    return () => { alive = false; ctrl.abort(); stop(); };
  }, [cloverOrderId, intervalMs, maxMs, enabled]);

  return {
    status,
    error,
    paid: Boolean(status?.paid),
    voided: Boolean(status?.voided),
    settled: Boolean(status?.settled),
  };
}

/**
 * Credit anything that was paid for while the app was closed.
 *
 * `useOrderPayment` only polls while the tracking screen is mounted, so the
 * ordinary case — order, close the app, pay at the counter — never reached the
 * award at all. This runs once per launch over the recent unpaid orders and
 * calls `onPaid` for each one Clover says is paid.
 *
 * Once per launch, not once per render: `ran` latches, so a state update from
 * the very first award cannot restart the sweep it came from. And `orders` is
 * read through a ref rather than depended on, because awarding rewrites the
 * array and a dependency on it would loop.
 *
 * Every failure is swallowed. A customer opening the app to look at the menu
 * with no signal must not be shown an error about a settlement sweep they did
 * not ask for; the tracking screen's own poll and the next launch both get
 * another go.
 */
export function useReconcileOnLaunch(orders, { enabled = true, onPaid } = {}) {
  const latest = useRef(orders);
  const ran = useRef(false);
  latest.current = orders;

  useEffect(() => {
    if (!enabled || ran.current) return;
    const due = ordersToReconcile(latest.current ?? []);
    ran.current = true;
    if (!due.length) return;

    let alive = true;
    const ctrl = new AbortController();
    (async () => {
      for (const order of due) {
        if (!alive) return;
        try {
          const s = await getOrderStatus(order.cloverOrderId, ctrl.signal);
          /* Paid only. A voided order is settled too, and awarding on
             `settled` would credit food that was cancelled at the register. */
          if (alive && s?.paid && !s?.voided) onPaid?.(order);
        } catch {
          /* offline, proxy down, or a 500 — try again next launch */
        }
      }
    })();

    return () => { alive = false; ctrl.abort(); };
  }, [enabled, onPaid]);
}

/**
 * The customer's Petals balance, from the server.
 *
 * NOTHING HERE IS CACHED, and that is the point. The balance used to live on the
 * device, so a reinstall wiped it with no record and staff took the complaint.
 * Now the server is the only answer: `petals` is a number when the server said
 * so and `null` when it did not, and every screen has to handle null rather
 * than falling back to a figure of its own. A remembered balance is the device
 * asserting money again.
 *
 * The first call is a CLAIM rather than a read, once per install, carrying
 * whatever the device still had so an existing customer does not lose it. The
 * server applies that once — a unique key behind it, so a retry cannot double
 * it — and after that `deviceBalance` is never sent again.
 *
 * `available: false` means "we could not ask". The rewards screen shows the
 * balance as unavailable and refuses to redeem; ordering is untouched, because
 * the app takes no money and an unreachable balance must never cost a sale.
 */
export function usePetalsBalance({ name, phone, deviceBalance = 0, enabled = true } = {}) {
  const [state, setState] = useState({ petals: null, known: false, available: false, error: null });
  const claimed = useRef(false);
  /* Read through a ref so a changing device balance cannot re-trigger the
     claim — the claim is once per install, not once per render. */
  const pending = useRef(deviceBalance);
  pending.current = deviceBalance;

  const ask = useCallback(async (signal) => {
    if (!name || !phone) return;
    try {
      const body = { name, phone };
      const res = claimed.current
        ? await getPetalsBalance(body, signal)
        : await claimPetals({ ...body, deviceBalance: pending.current }, signal);
      claimed.current = true;
      setState({ petals: res.petals ?? 0, known: Boolean(res.known), available: true, error: null });
    } catch (e) {
      if (e?.name === "AbortError") return;
      /* Every failure lands here, including PETALS_UNAVAILABLE from a proxy with
         no database. The distinction the UI needs is only "can we ask or not",
         so they are treated the same and the message is kept for the notice. */
      setState({ petals: null, known: false, available: false, error: e?.message ?? "unavailable" });
    }
  }, [name, phone]);

  useEffect(() => {
    if (!enabled || !name || !phone) {
      setState({ petals: null, known: false, available: false, error: null });
      return;
    }
    const ctrl = new AbortController();
    ask(ctrl.signal);
    return () => ctrl.abort();
  }, [enabled, name, phone, ask]);

  /* Called after an order and after a payment is confirmed. The server moved
     the balance; this is how the screen finds out, rather than the client
     doing its own arithmetic and hoping the two agree. */
  const refresh = useCallback(() => { ask(); }, [ask]);

  return { ...state, refresh };
}

/**
 * Which loyalty scheme is in force. Asked once — a merchant does not turn a
 * loyalty programme on and off mid-session — and null until it answers, which
 * every caller reads as "our own scheme", the same as no programme at all.
 */
export function useLoyaltySource({ enabled = true } = {}) {
  const [loyalty, setLoyalty] = useState(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const ctrl = new AbortController();
    getLoyalty(ctrl.signal)
      .then((l) => { if (alive) setLoyalty(l); })
      // A failed lookup is not worth showing anyone: the in-app scheme runs.
      .catch(() => {});
    return () => { alive = false; ctrl.abort(); };
  }, [enabled]);

  return loyalty;
}
