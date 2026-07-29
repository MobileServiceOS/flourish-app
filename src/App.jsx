import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { ShoppingBag, Check, Home, Receipt, User, Award } from "lucide-react";

import "./styles.css";
import { MENU, UE, CAT_OF, PLATE_IDS, hasChoices } from "./data/menu.data.js";
import { cents, withTax } from "./lib/money.js";
import { rewardOf, discountFor } from "./lib/loyalty.js";
import { loadAccount, saveAccount } from "./lib/storage.js";
import { DOW, TODAY_IS_FRIDAY, SEAFOOD_CAT, POPULAR, ALL_ITEMS } from "./lib/restaurant.js";
import { createOrder, pay, syncCustomer, setStock, ApiError } from "./lib/clover.js";
import { useCloverHealth, useInventorySync } from "./hooks/clover.js";

import Splash from "./components/Splash.jsx";
import {
  splashSeen, markSplashSeen, prefersReducedMotion,
  SPLASH_HOLD_MS, SPLASH_FADE_MS, SPLASH_REDUCED_MS,
} from "./lib/splashSession.js";
import MenuView from "./components/MenuView.jsx";
import ItemSheet from "./components/ItemSheet.jsx";
import StaffSheet from "./components/StaffSheet.jsx";
import CartView from "./components/CartView.jsx";
import CheckoutView from "./components/CheckoutView.jsx";
import TrackView from "./components/TrackView.jsx";
import SignInView from "./components/SignInView.jsx";
import RewardsView from "./components/RewardsView.jsx";
import OrdersView from "./components/OrdersView.jsx";

/* ============================================================
   FLOURISH BX — Pickup ordering app
   4035 Laconia Ave, Bronx NY 10466 · (347) 859-9413

   This file owns the state and routes between screens. Each screen lives in
   src/components/. Facts about the shop are in src/lib/restaurant.js; menu
   data comes from the Clover export and is never hand-edited.

   MENU DATA — item ids and modifier group ids are live Clover object ids, so
   a cart line maps 1:1 onto a Clover order. Line price is base + selected
   variant modifier + side upcharges. Four mispriced modifiers in Clover are
   worked around in the data (mods flagged oos:true); Clover itself still
   needs correcting — see CLOVER-FIXES.md.

   NOT YET WIRED: Clover payments and order push. Needs merchant id + API
   tokens. Until then checkout simulates and prints nothing to the kitchen.
   ============================================================ */

export default function App() {
  const [view, setView] = useState("menu");
  const [activeCat, setActiveCat] = useState(TODAY_IS_FRIDAY ? "Seafood Fridays" : MENU[0].cat);
  const [detail, setDetail] = useState(null);
  const [cart, setCart] = useState([]);
  const [search, setSearch] = useState("");
  const [staffOpen, setStaffOpen] = useState(false);

  /* Sold-out now comes from Clover stock levels, with the manual 86 layered on
     top so staff can pull something before the count runs down. */
  const clover = useCloverHealth();
  const inventory = useInventorySync({ enabled: clover.status === "online" });
  const soldOut = inventory.soldOut;

  /* The manual toggle also pushes back to Clover when connected, so the 86
     shows up on the register and on every other ordering channel — not just
     in this one app. A failed push still flips it locally. */
  const toggleSold = async (id) => {
    const wasOut = inventory.manual.has(id) || inventory.fromClover.has(id);
    inventory.toggleManual(id);
    if (clover.status !== "online") return;
    try {
      await setStock(id, wasOut ? 1 : 0);
    } catch {
      flash("Marked here, but the register didn't accept it");
    }
  };

  const [submitting, setSubmitting] = useState(false);
  const [payError, setPayError] = useState(null);
  const [account, setAccount] = useState(null);   // null = signed out
  const [loadingAcct, setLoadingAcct] = useState(true);
  const [vouchers, setVouchers] = useState([]);   // redeemed, unused rewards
  const [points, setPoints] = useState(0);
  const [orders, setOrders] = useState([]);
  const [active, setActive] = useState(null); // active order being tracked
  const [toast, setToast] = useState(null);
  const catRefs = useRef({});

  /* Launch screen. Three states: showing the bloom, fading out, gone.
     It leaves only once BOTH the animation has had its time and the account has
     come back — so a slow read never cuts the bloom short, and a fast one never
     flashes past. Second launch in a session skips it entirely. */
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);
  const [splash, setSplash] = useState(() => (splashSeen() ? "gone" : "showing"));
  const [heldLongEnough, setHeldLongEnough] = useState(() => splashSeen());

  useEffect(() => {
    if (splashSeen()) return;
    const hold = reducedMotion ? SPLASH_REDUCED_MS : SPLASH_HOLD_MS;
    const t = setTimeout(() => setHeldLongEnough(true), hold);
    return () => clearTimeout(t);
  }, [reducedMotion]);

  // Start the exit once the bloom has had its time and the account is back.
  useEffect(() => {
    if (splash !== "showing") return;
    if (!heldLongEnough || loadingAcct) return;
    markSplashSeen();
    setSplash("leaving");
  }, [splash, heldLongEnough, loadingAcct]);

  /* Unmount after the fade. This has to be its own effect: scheduling the timer
     in the one above meant setSplash("leaving") re-ran it, and the cleanup
     cancelled the timer it had just set — the splash never left. */
  useEffect(() => {
    if (splash !== "leaving") return;
    const t = setTimeout(() => setSplash("gone"), reducedMotion ? 0 : SPLASH_FADE_MS);
    return () => clearTimeout(t);
  }, [splash, reducedMotion]);


  // Restore the signed-in customer on launch
  useEffect(() => {
    let alive = true;
    loadAccount().then((a) => {
      if (!alive) return;
      if (a) {
        setAccount({ name: a.name, phone: a.phone, since: a.since });
        setPoints(a.points || 0);
        setOrders(a.orders || []);
        setVouchers(a.vouchers || []);
      }
      setLoadingAcct(false);
    });
    return () => { alive = false; };
  }, []);

  // Persist whenever anything the customer owns changes
  useEffect(() => {
    if (loadingAcct || !account) return;
    saveAccount({ ...account, points, orders, vouchers });
  }, [account, points, orders, vouchers, loadingAcct]);

  const signIn = async (name, phone) => {
    const acct = { name, phone, since: new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" }) };
    setAccount(acct);
    flash(`Welcome, ${name.split(" ")[0]}`);

    /* Mirror the customer into Clover so the merchant's own reports show
       customer-level data. Best effort: a customer who can't be synced still
       gets a working account and points here, and the id fills in next time. */
    if (clover.status !== "online") return;
    try {
      const { customerId } = await syncCustomer(name, phone);
      if (customerId) setAccount((a) => (a ? { ...a, cloverCustomerId: customerId } : a));
    } catch { /* non-fatal, the order just goes through without a customer id */ }
  };
  const signOut = () => {
    setAccount(null); setPoints(0); setOrders([]); setVouchers([]);
    saveAccount(null);
    setView("menu");
    flash("Signed out");
  };
  const redeem = (r) => {
    if (points < r.cost) return flash("Not enough points yet");
    setPoints((p) => p - r.cost);
    setVouchers((v) => [...v, { rid: r.id, name: r.name, cost: r.cost,
      code: "FL" + Math.floor(1000 + Math.random() * 9000), got: "Today" }]);
    flash(`${r.name} unlocked`);
  };

  const [applied, setApplied] = useState(null); // voucher code applied to this cart
  const appliedVoucher = vouchers.find((v) => v.code === applied) || null;
  const discount = discountFor(appliedVoucher, cart);

  const query = search.trim().toLowerCase();
  const filteredMenu = useMemo(() => {
    if (!query) return MENU;
    return MENU.map((c) => ({
      ...c,
      items: c.items.filter((it) => {
        const hay = [it.name, it.desc || "", it.emoji || "", c.cat].join(" ").toLowerCase();
        return hay.includes(query);
      }),
    })).filter((c) => c.items.length > 0);
  }, [query]);
  useEffect(() => {
    if (!query) return;
    if (!filteredMenu.some((c) => c.cat === activeCat) && filteredMenu.length) {
      setActiveCat(filteredMenu[0].cat);
    }
  }, [filteredMenu, activeCat, query]);
  /* On Fridays the seafood leads — it's what people come in for, and it's the
     chip that starts selected, so it has to be the section sitting at the top
     or the scroll-spy would immediately move the highlight off it. */
  const activeMenu = useMemo(() => {
    if (query) return filteredMenu;
    const base = [POPULAR, ...MENU];
    if (!TODAY_IS_FRIDAY) return base;
    const seafood = base.find((c) => c.cat === SEAFOOD_CAT);
    return seafood ? [seafood, ...base.filter((c) => c !== seafood)] : base;
  }, [query, filteredMenu]);

  const cartCount = cart.reduce((n, l) => n + l.qty, 0);
  const subtotal = cart.reduce((s, l) => s + l.price * l.qty, 0);
  const saved = cart.reduce((s, l) => s + (l.save || 0) * l.qty, 0);

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(null), 1600); };

  // If the qualifying item leaves the cart, release the reward back to the customer
  useEffect(() => {
    if (applied && discount === 0) {
      setApplied(null);
      flash("Reward removed, no qualifying item");
    }
  }, [cart, applied, discount]);

  const applyVoucher = (code) => {
    const v = vouchers.find((x) => x.code === code);
    const d = discountFor(v, cart);
    if (!d) return flash(`Add ${rewardOf(v).needs} to use this`);
    setApplied(code);
    flash(`${v.name} applied`);
  };

  const addToCart = (line, { silent = false } = {}) => {
    setCart((c) => [...c, { ...line, key: Date.now() + Math.random() }]);
    if (!silent) flash(`${line.name} added`);
  };

  /* Reorder puts the whole previous order back, modifiers and all.
     The line is copied wholesale minus its old cart key — carrying itemId,
     modifiers, note, plate and save forward is what lets a reordered line
     still earn rewards and still map onto a Clover order. Anything 86'd today
     or off-schedule is left out and named, rather than silently dropped. */
  const reorder = (order) => {
    const skipped = [];
    let added = 0;
    for (const line of order.lines) {
      const item = ALL_ITEMS.find((i) => i.id === line.itemId);
      const offToday = item?.days && !item.days.includes(DOW);
      if (soldOut.has(line.itemId) || offToday) { skipped.push(line.name); continue; }
      const { key, ...rest } = line;
      addToCart(rest, { silent: true });
      added++;
    }
    setView("cart");
    if (!added) flash("Nothing from that order is available today");
    else if (skipped.length) flash(`Added — ${skipped.join(", ")} unavailable today`);
    else flash(`Reordered ${order.num}`);
  };
  // One-tap add for items with zero choices (plain drinks, plain sides)
  const quickAdd = (it) => {
    if (hasChoices(it)) return false;
    addToCart({ name: it.name, meta: "", price: it.base, qty: 1, modifiers: [],
      save: UE[it.id] ? Math.max(0, cents(UE[it.id] - it.base)) : 0,
      itemId: it.id, cat: CAT_OF[it.id], plate: PLATE_IDS.has(it.id) });
    return true;
  };

  const setQty = (key, d) =>
    setCart((c) => c.map((l) => l.key === key ? { ...l, qty: Math.max(1, l.qty + d) } : l));
  const removeLine = (key) => setCart((c) => c.filter((l) => l.key !== key));

  /* Tapping a chip and scroll-spy both write activeCat, so they fight: the
     smooth scroll passes over every section on the way and the spy would drag
     the highlight along with it. Tapping wins for as long as the scroll runs. */
  const spyMutedUntil = useRef(0);
  const scrollToCat = useCallback((cat) => {
    setActiveCat(cat);
    spyMutedUntil.current = Date.now() + 800;
    const el = catRefs.current[cat];
    if (el?.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  /* Highlight the chip for whichever section is under the nav as you scroll. */
  const catKeys = activeMenu.map((c) => c.cat).join("|");
  useEffect(() => {
    if (view !== "menu") return;
    if (typeof IntersectionObserver === "undefined") return;
    const cats = catKeys.split("|").filter(Boolean);
    const els = cats.map((c) => catRefs.current[c]).filter(Boolean);
    if (!els.length) return;

    // IntersectionObserver only reports what *changed*, so keep the running set
    // and re-pick the top-most section from it on every callback.
    const onScreen = new Map();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) onScreen.set(e.target.dataset.cat, e.isIntersecting);
      if (Date.now() < spyMutedUntil.current) return;
      const first = cats.find((c) => onScreen.get(c));
      if (first) setActiveCat(first);
    }, { rootMargin: "-96px 0px -65% 0px", threshold: 0 });

    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [view, catKeys]);

  /* ---------- placing the order ----------
     Order of operations matters here:
       1. push the order to Clover first, so the kitchen has it
       2. charge the card second
     Doing it the other way round risks a charged customer with no order on the
     register, which is the one outcome staff cannot fix from the counter.
     A failed charge on an existing order is recoverable — they pay at pickup. */
  const placeOrder = async (pickup, tip, method = "pickup", cardApi = null) => {
    setPayError(null);
    setSubmitting(true);

    const net = Math.max(0, subtotal - discount);
    const localTotal = cents(withTax(net) + tip);
    const reward = appliedVoucher
      ? { name: appliedVoucher.name, code: appliedVoucher.code, amount: discount }
      : null;

    try {
      let cloverOrderId = null;
      let printed = null;

      if (clover.status === "online") {
        // Tokenize before creating the order — a card the customer mistyped
        // should not leave an abandoned ticket in the kitchen.
        let token = null;
        if (method === "card") {
          if (!cardApi) throw new ApiError("The card form isn't ready yet.");
          token = await cardApi.tokenize();
        }

        const res = await createOrder({
          cart, reward, customerId: account?.cloverCustomerId ?? null,
          pickupLabel: pickup.label,
        });
        cloverOrderId = res.orderId;
        printed = res.printed;

        if (method === "card") {
          /* Charge what Clover priced the order at when it tells us, and fall
             back to our own estimate only when it doesn't. Clover is the
             register: if its tax rules disagree with TAX_RATE, the amount on
             the card has to follow the order, not the app, or the till is out
             by the difference on every card sale. */
          const dueFromClover = typeof res.total === "number" ? res.total / 100 : null;
          await pay({
            source: token,
            amountDollars: dueFromClover ?? withTax(net),
            tipDollars: tip,
            orderId: cloverOrderId,
          });
        }
        if (printed === false) {
          flash("Order received — the kitchen printer is down, staff have it on screen");
        }
      }

      const order = {
        num: cloverOrderId ? `FL-${String(cloverOrderId).slice(-4).toUpperCase()}` : "FL-" + Math.floor(2000 + Math.random() * 8000),
        cloverOrderId, when: "Today", total: localTotal, status: "preparing",
        pickup: pickup.label, readyAt: pickup.at.toISOString(), tip,
        paidBy: method, printed, reward,
        lines: cart.map((l) => ({ ...l })),
      };

      setActive(order);
      setOrders((o) => [order, ...o]);
      if (account) setPoints((p) => p + Math.round(subtotal - discount));
      if (appliedVoucher) {
        setVouchers((v) => v.filter((x) => x.code !== appliedVoucher.code));
        setApplied(null);
      }
      setCart([]);
      setView("track");
    } catch (e) {
      // Never fail silently on an order. Every branch here ends with the
      // customer being told something they can act on.
      const declined = e.status === 402;
      setPayError({
        message: e.isPreview
          ? "App is in preview mode — ordering is not connected yet"
          : declined ? (e.message || "Card declined.")
          : e.code === "MODIFIER_UNRESOLVED" ? e.message
          : e.message || "Couldn't reach the kitchen — try again",
        declineReason: e.declineReason ?? null,
        retryable: !e.isPreview && e.code !== "MODIFIER_UNRESOLVED",
      });
    } finally {
      setSubmitting(false);
    }
  };

  /* Hold the app back until we know whether this is a returning customer.
     Without this the Rewards tab renders the "Join Flourish Rewards" pitch for
     a frame before the saved account arrives — an existing customer being
     asked to sign up again.

     The bloom animation also holds it for its own duration, but only the first
     time in a session; coming back from the lock screen goes straight in. */
  /* Two separate reasons to hold, and they must both be satisfied:
       - the account has not come back yet   (every launch, no exceptions)
       - the bloom has not finished          (first launch of a session only)
     Collapsing these into one flag is what briefly let the sign-in pitch through
     on a second launch. */
  if (loadingAcct || splash !== "gone") {
    return <Splash leaving={!loadingAcct && splash === "leaving"} reduced={reducedMotion} />;
  }

  return (
    <div className="fx shell">

      {view === "menu" && <MenuView {...{ activeCat, scrollToCat, setDetail, catRefs, soldOut, openStaff: () => setStaffOpen(true), flash, quickAdd, search, setSearch, menu: activeMenu,
        /* Only badge SANDBOX when we are actually talking to the register. The
           flag alone is true whenever CLOVER_API_BASE points at a test host,
           which showed the badge with no proxy running at all — a warning about
           test orders makes no sense when no order can be placed. */
        sandbox: clover.status === "online" && clover.sandbox }} />}
      {view === "rewards" && (account
        ? <RewardsView {...{ account, points, vouchers, orders, redeem, signOut }} onReorder={reorder} />
        : <SignInView onSignIn={signIn} />)}
      {view === "orders" && <OrdersView orders={orders} active={active} onReorder={reorder}
        onBrowse={() => setView("menu")} onTrack={() => active && setView("track")} />}
      {view === "cart" && <CartView {...{ cart, subtotal, saved, account, setQty, removeLine, setView,
          vouchers, applied, appliedVoucher, discount, applyVoucher, clearVoucher: () => setApplied(null) }} />}
      {view === "checkout" && (
        <CheckoutView subtotal={subtotal} points={points} account={account} goJoin={() => setView("rewards")}
          discount={discount} appliedVoucher={appliedVoucher}
          onBack={() => setView("cart")}
          cloverStatus={clover.status} cloverReason={clover.reason}
          submitting={submitting} payError={payError}
          onClearError={() => setPayError(null)}
          onPay={placeOrder} />
      )}
      {view === "track" && active && <TrackView order={active} setView={setView} live={clover.status === "online"} />}

      {detail && (
        <ItemSheet item={detail} onClose={() => setDetail(null)}
          onAdd={(line) => { addToCart(line); setDetail(null); }} />
      )}

      {staffOpen && (
        <StaffSheet soldOut={soldOut} fromClover={inventory.fromClover} toggleSold={toggleSold}
          connected={clover.status === "online"} lastSync={inventory.lastSync}
          onClose={() => setStaffOpen(false)} />
      )}

      {toast && <div className="toast"><Check size={16} /> {toast}</div>}

      {view !== "track" && (
        <nav className="tabbar" aria-label="Main">
          <button className={`tab ${view === "menu" ? "on" : ""}`} onClick={() => setView("menu")}
            aria-current={view === "menu" ? "page" : undefined}>
            <Home size={20} aria-hidden="true" /> Menu
          </button>
          <button className={`tab ${view === "rewards" ? "on" : ""}`} onClick={() => setView("rewards")}
            aria-current={view === "rewards" ? "page" : undefined}>
            {account ? <Award size={20} aria-hidden="true" /> : <User size={20} aria-hidden="true" />}
            {account ? "Rewards" : "Sign in"}
          </button>
          <button className={`tab ${view === "orders" ? "on" : ""}`} onClick={() => setView("orders")}
            aria-current={view === "orders" ? "page" : undefined}>
            <Receipt size={20} aria-hidden="true" /> Orders
          </button>
          <button className={`tab ${view === "cart" ? "on" : ""}`} onClick={() => setView("cart")}
            aria-current={view === "cart" ? "page" : undefined}
            aria-label={cartCount > 0
              ? `Cart, ${cartCount} item${cartCount > 1 ? "s" : ""}`
              : "Cart, empty"}>
            <ShoppingBag size={20} aria-hidden="true" /> Cart
            {cartCount > 0 && (
              <span className="dot" key={cartCount} aria-hidden="true">{cartCount}</span>
            )}
          </button>
        </nav>
      )}
    </div>
  );
}
