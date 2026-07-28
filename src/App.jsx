import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  ShoppingBag, Plus, Minus, Star, Clock, MapPin, Phone, ChevronLeft,
  Check, Gift, Home, Receipt, X, Sparkles, RotateCcw, Navigation, Lock,
  User, LogOut, Award, Ticket, ChevronRight, Share2
} from "lucide-react";

import "./styles.css";
import { MENU, UE, CAT_OF, PLATE_IDS, DRINK_ID, SIDE_ID, POPULAR_IDS, hasChoices } from "./data/menu.data.js";
import { cents, money } from "./lib/money.js";
import { TIERS, REWARDS, rewardOf, discountFor, tierFor, nextTier } from "./lib/loyalty.js";
import { loadAccount, saveAccount } from "./lib/storage.js";
import {
  isOpen, nextOpening, pickupSlots, asapReadyAt, formatTime, describeOpening,
  closingOn, HOURS_LINE,
} from "./lib/hours.js";
import { formatPhone, phoneDigits, isValidPhone, isValidName } from "./lib/phone.js";

/* ============================================================
   FLOURISH BX — Pickup ordering app
   4035 Laconia Ave, Bronx NY 10466 · (347) 859-9413 · 9AM-10PM daily
   Native-ready (Capacitor + React). Pickup only, no delivery.

   MENU DATA — from the Clover inventory export, not hand-entered.
   Item ids and modifier group ids are live Clover object ids, so a
   cart line maps 1:1 onto a Clover order. Line price is
   base + selected variant modifier + side upcharges.
   Regenerate from a fresh Clover export rather than editing prices here.

   Four mispriced modifiers in Clover are worked around in this file
   (mods flagged oos:true). Clover itself still needs correcting —
   see CLOVER-FIXES.md.

   NOT YET WIRED: Clover payments and order push. Needs merchant id +
   API tokens. Until then checkout simulates and prints nothing to the
   kitchen. Everything else — menu, cart, account, rewards, 86 control
   — is real and working.
   ============================================================ */


const IMG = (id) =>
  `https://img.cdn4dd.com/cdn-cgi/image/fit=contain,width=600,height=600,format=auto/https://doordash-static.s3.amazonaws.com/media/photosV2/${id}-retina-large.jpg`;


const DOW = new Date().getDay(); // 0=Sun ... 6=Sat
const TODAY_IS_FRIDAY = DOW === 5;
const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const daysLabel = (days) => days.map((d) => DOW_NAMES[d]).join(" & ") + " only";

const SEAFOOD_CAT = "Seafood Fridays";
export const ADDRESS = "4035 Laconia Ave, Bronx, NY 10466";
export const PHONE_E164 = "+13478599413";
export const PHONE_HUMAN = "(347) 859-9413";
export const MAPS_URL =
  "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(ADDRESS);

/* The Popular section renders the *same* item objects as the real categories —
   POPULAR_IDS holds ids and we look them up, so there is one source of truth for
   price, sold-out state and modifiers. Never copy an item here. */
const ALL_ITEMS = MENU.flatMap((c) => c.items);
const POPULAR = {
  cat: "Popular",
  sub: "What we're known for",
  items: POPULAR_IDS.map((id) => ALL_ITEMS.find((it) => it.id === id)).filter(Boolean),
};

/* A chip label — Seafood Fridays reads "(Fri)" on the six days it isn't on. */
const chipLabel = (cat) =>
  cat === SEAFOOD_CAT && !TODAY_IS_FRIDAY ? `${cat} (Fri)` : cat;

export const SHARE_URL = "https://flourishbx.com";
export const SHARE_TEXT =
  "Order pickup from Flourish BX — real Caribbean food, no delivery app markup. " + SHARE_URL;

/* Native share sheet on a phone, clipboard on a desktop browser. Resolves to
   what actually happened so the button can say so; a cancelled share sheet
   throws AbortError and should leave the label alone. */
export async function shareFlourish(nav = globalThis.navigator) {
  try {
    if (nav?.share) {
      await nav.share({ title: "Flourish BX", text: SHARE_TEXT, url: SHARE_URL });
      return "shared";
    }
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(SHARE_TEXT);
      return "copied";
    }
  } catch (e) {
    if (e?.name === "AbortError") return null;   // customer backed out
  }
  return null;
}

function Hummingbird({ style, size = 44, flip }) {
  return (
    <svg className="floral" style={style} width={size} height={size} viewBox="0 0 64 64"
      fill="none" transform={flip ? "scale(-1,1)" : ""}>
      <path d="M30 34c-6 2-14 3-22 1 6 5 14 6 20 4z" fill="var(--teal)"/>
      <path d="M34 30c4-6 6-14 5-22-5 6-7 14-6 20z" fill="var(--orchid-lt)"/>
      <ellipse cx="33" cy="34" rx="8" ry="5" fill="var(--pink)"/>
      <path d="M40 33l10-3-9 6z" fill="var(--orchid)"/>
      <circle cx="30" cy="32" r="2" fill="var(--orchid)"/>
    </svg>
  );
}

function Thumb({ item }) {
  const [err, setErr] = useState(false);
  const src = item.img || IMG(item.id);
  if (src && !err) {
    return <img className="thumb" src={src} alt={item.name} onError={() => setErr(true)} />;
  }
  return <div className="thumb">{item.emoji || "🍽️"}</div>;
}


export default function App() {
  const [view, setView] = useState("menu");
  const [activeCat, setActiveCat] = useState(TODAY_IS_FRIDAY ? "Seafood Fridays" : MENU[0].cat);
  const [detail, setDetail] = useState(null);
  const [cart, setCart] = useState([]);
  const [soldOut, setSoldOut] = useState(new Set());
  const [search, setSearch] = useState("");
  const [staffOpen, setStaffOpen] = useState(false);
  const toggleSold = (id) => setSoldOut((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const [account, setAccount] = useState(null);   // null = signed out
  const [loadingAcct, setLoadingAcct] = useState(true);
  const [vouchers, setVouchers] = useState([]);   // redeemed, unused rewards
  const [points, setPoints] = useState(0);
  const [orders, setOrders] = useState([]);
  const [active, setActive] = useState(null); // active order being tracked
  const [toast, setToast] = useState(null);
  const catRefs = useRef({});

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

  const signIn = (name, phone) => {
    const acct = { name, phone, since: new Date().toLocaleDateString("en-US", { month: "short", year: "numeric" }) };
    setAccount(acct);
    flash(`Welcome, ${name.split(" ")[0]}`);
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

  return (
    <div className="fx shell">

      {view === "menu" && <MenuView {...{ activeCat, scrollToCat, setDetail, catRefs, soldOut, openStaff: () => setStaffOpen(true), flash, quickAdd, search, setSearch, menu: activeMenu }} />}
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
          onPay={(pickup, tip) => {
            const net = Math.max(0, subtotal - discount);
            const total = cents(cents(net * 1.08875) + tip);
            const num = "FL-" + Math.floor(2000 + Math.random() * 8000);
            // pickup is { label, at } from the time picker; `at` is a real Date.
            const order = { num, when: "Today", total, status: "preparing",
              pickup: pickup.label, readyAt: pickup.at.toISOString(), tip,
              reward: appliedVoucher ? { name: appliedVoucher.name, code: appliedVoucher.code, amount: discount } : null,
              lines: cart.map((l) => ({ ...l })) };
            setActive(order);
            setOrders((o) => [order, ...o]);
            if (account) setPoints((p) => p + Math.round(subtotal - discount));
            if (appliedVoucher) {
              setVouchers((v) => v.filter((x) => x.code !== appliedVoucher.code));
              setApplied(null);
            }
            setCart([]);
            setView("track");
          }} />
      )}
      {view === "track" && active && <TrackView order={active} setView={setView} />}

      {detail && (
        <ItemSheet item={detail} onClose={() => setDetail(null)}
          onAdd={(line) => { addToCart(line); setDetail(null); }} />
      )}

      {staffOpen && (
        <StaffSheet soldOut={soldOut} toggleSold={toggleSold} onClose={() => setStaffOpen(false)} />
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

/* ---------- MENU ---------- */
function MenuView({ activeCat, scrollToCat, setDetail, catRefs, soldOut, openStaff, flash, quickAdd, search, setSearch, menu }) {
  const navRef = useRef(null);
  // Which + button just fired, so it can pop. Cleared by a timer, not onAnimationEnd,
  // because tapping the same button twice needs the class removed in between.
  const [popped, setPopped] = useState(null);
  const popTimer = useRef(null);
  useEffect(() => () => clearTimeout(popTimer.current), []);

  const pop = (id) => {
    clearTimeout(popTimer.current);
    setPopped(null);
    // next frame, so React actually removes the class before re-adding it
    requestAnimationFrame(() => {
      setPopped(id);
      popTimer.current = setTimeout(() => setPopped(null), 420);
    });
  };

  // Keep the highlighted chip on screen as the spy moves it.
  useEffect(() => {
    const el = navRef.current?.querySelector(`[data-chip=${JSON.stringify(activeCat)}]`);
    if (el?.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activeCat]);

  // Adding an item is either one tap (no choices) or opens the sheet.
  const choose = (it, viaButton) => {
    if (quickAdd(it)) { if (viaButton) pop(it.id); return; }
    setDetail(it);
  };

  return (
    <>
      <header className="hdr">
        <Hummingbird style={{ top: 8, left: -6 }} size={54} />
        <Hummingbird style={{ top: 2, right: -4 }} size={48} flip />
        <div className="hdr-row">
          <div>
            <div style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>Order pickup from</div>
            <div className="wordmark" style={{ fontSize: 42 }}>Flourish</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            <button onClick={openStaff} title="Staff" aria-label="Staff: mark items sold out"
              style={{ width: 30, height: 30, borderRadius: 9, border: "1px solid var(--line)",
                background: "rgba(255,255,255,.75)", color: "var(--muted)", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Lock size={14} aria-hidden="true" />
            </button>
            <span className="badge"><Sparkles size={13} /> Pickup only · no delivery</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: 14, fontSize: 12.5, color: "var(--muted)", fontWeight: 600, position: "relative", zIndex: 2 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Star size={13} fill="#F5B841" stroke="none" /> 4.4 (830)</span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Clock size={13} /> Ready in ~15 min</span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><MapPin size={13} /> 4035 Laconia Ave</span>
        </div>
      </header>

      <div className="search-row">
        <input className="search" placeholder="Search menu" value={search}
          onChange={(e) => setSearch(e.target.value)} aria-label="Search menu" />
        {search && (
          <button className="search-clear" onClick={() => setSearch("")} aria-label="Clear search">
            <X size={18} />
          </button>
        )}
      </div>
      {TODAY_IS_FRIDAY && !search && (
        <button className="promo-banner" onClick={() => scrollToCat(SEAFOOD_CAT)}
          aria-label="It's Seafood Friday. Jump to the Seafood Fridays menu.">
          <span className="promo-emoji" aria-hidden="true">🐟</span>
          <span>
            <strong>It's Seafood Friday!</strong>
            <span style={{ display: "block", color: "var(--muted)", fontSize: 12, marginTop: 2 }}>
              Crab legs, lobster and shrimp platters — today only. Tap to see them.
            </span>
          </span>
          <ChevronRight size={18} style={{ marginLeft: "auto", flex: "0 0 auto" }} aria-hidden="true" />
        </button>
      )}

      <div className="cat-nav" ref={navRef} role="tablist" aria-label="Menu sections">
        {menu.map((c) => (
          <button key={c.cat} data-chip={c.cat} role="tab"
            aria-selected={activeCat === c.cat}
            className={`chip ${activeCat === c.cat ? "on" : ""}`}
            onClick={() => scrollToCat(c.cat)}>
            {chipLabel(c.cat)}
          </button>
        ))}
      </div>

      {menu.length === 0 ? (
        <Empty icon={<X size={30} />} title="No items match"
          text={`Nothing on the menu matches "${search}".`}
          cta="Clear search" onCta={() => setSearch("")} />
      ) : menu.map((c) => (
        <section key={c.cat} data-cat={c.cat} ref={(el) => (catRefs.current[c.cat] = el)}
          aria-labelledby={`sec-${c.cat.replace(/\W+/g, "-")}`}>
          <h2 className="sec-title" id={`sec-${c.cat.replace(/\W+/g, "-")}`}>{chipLabel(c.cat)}</h2>
          {c.sub && <div style={{ margin: "-6px 20px 12px", color: "var(--muted)", fontSize: 13 }}>{c.sub}</div>}
          {c.items.map((it) => {
            const sched = it.days && !it.days.includes(DOW);
            const out = soldOut.has(it.id) || sched;
            const badge = sched ? daysLabel(it.days).toUpperCase() : "SOLD OUT TODAY";
            const msg = sched ? `${it.name} is available ${daysLabel(it.days).toLowerCase()}` : `${it.name} is sold out today`;
            return (
            <div key={it.id} className="item" style={out ? { opacity: .55 } : undefined}
              role="button" tabIndex={0}
              aria-disabled={out || undefined}
              aria-label={`${it.name}${it.desc ? ", " + it.desc : ""}, from ${money(it.lo)}${out ? ", " + badge.toLowerCase() : ""}`}
              onClick={() => out ? flash(msg) : choose(it)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                out ? flash(msg) : choose(it);
              }}>
              <div style={{ position: "relative" }}>
                <Thumb item={it} />
                {out && <div style={{ position: "absolute", inset: 0, borderRadius: 14, background: "rgba(58,46,69,.35)" }} />}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15.5, display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                  {it.name}
                  {out && <span style={{ fontSize: 10.5, fontWeight: 700, color: sched ? "var(--plum-ink)" : "var(--rose-ink)", background: sched ? "rgba(142,91,196,.16)" : "rgba(232,154,199,.22)", padding: "2px 7px", borderRadius: 999 }}>{badge}</span>}
                </div>
                {it.desc && <div style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 2, lineHeight: 1.35 }}>{it.desc}</div>}
                <div className="price" style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span>
                    {it.lo === it.hi ? money(it.lo) : <>{money(it.lo)} <span style={{ color: "var(--muted)", fontWeight: 600 }}>–</span> {money(it.hi)}</>}
                  </span>
                  {UE[it.id] > it.lo && (
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--teal-ink)", background: "rgba(47,182,168,.14)",
                      padding: "2px 7px", borderRadius: 999, letterSpacing: .2 }}>
                      SAVE {money(UE[it.id] - it.lo)}
                    </span>
                  )}
                </div>
              </div>
              <button className={`addbtn${popped === it.id ? " pop" : ""}`} disabled={out}
                style={out ? { background: "var(--line)", boxShadow: "none", cursor: "not-allowed" } : undefined}
                aria-label={hasChoices(it) ? `Choose options for ${it.name}` : `Add ${it.name} to cart`}
                onClick={(e) => { e.stopPropagation(); out ? flash(msg) : choose(it, true); }}>
                <Plus size={18} aria-hidden="true" />
              </button>
            </div>
          );})}
        </section>
      ))}
      <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 11.5, padding: "8px 30px 20px", lineHeight: 1.5 }}>
        {HOURS_LINE}. Pickup only at 4035 Laconia Ave. No delivery, no service fees.
      </div>
    </>
  );
}

/* ---------- ITEM CUSTOMIZE SHEET ---------- */
/* Renders whatever modifier groups the item carries in Clover:
   variant = priced single-select (sizes, flavors that set price)
   flavor  = free single-select
   side    = "Side With Meal", picked twice, some carry an upcharge */
function ItemSheet({ item, onClose, onAdd }) {
  const variants = item.groups.filter((g) => g.kind === "variant");
  const flavors  = item.groups.filter((g) => g.kind === "flavor");
  const sideG    = item.groups.find((g) => g.kind === "side");

  // default each priced group to its cheapest real option
  const [sel, setSel] = useState(() => {
    const init = {};
    [...variants, ...flavors].forEach((g) => {
      const i = g.mods.findIndex((m) => !m.oos);
      init[g.gid] = i < 0 ? 0 : i;
    });
    return init;
  });
  const freeSide = sideG ? Math.max(0, sideG.mods.findIndex((m) => m.p === 0)) : 0;
  const [side1, setSide1] = useState(freeSide);
  const [side2, setSide2] = useState(freeSide);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");

  const variantSum = variants.reduce((t, g) => t + g.mods[sel[g.gid]].p, 0);
  const sideSum = sideG ? sideG.mods[side1].p + sideG.mods[side2].p : 0;
  const unit = cents(item.base + variantSum + sideSum);

  // Exact modifier list for the Clover order push
  const chosen = [
    ...[...variants, ...flavors].map((g) => ({ gid: g.gid, name: g.mods[sel[g.gid]].n, price: g.mods[sel[g.gid]].p })),
    ...(sideG ? [
      { gid: sideG.gid, name: sideG.mods[side1].n, price: sideG.mods[side1].p },
      { gid: sideG.gid, name: sideG.mods[side2].n, price: sideG.mods[side2].p },
    ] : []),
  ];
  const meta = chosen.map((c) => c.name).join(" · ");

  const ue = UE[item.id];
  const saves = ue && unit < ue ? cents(ue - unit) : 0;

  const sheetRef = useSheet(onClose);

  return (
    <div className="sheet-wrap">
      <div className="scrim" onClick={onClose} />
      <div className="sheet" ref={sheetRef} tabIndex={-1}
        role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <div className="sheet-head">
          <div style={{ minWidth: 0 }}>
            <h2 className="serif" id="sheet-title" style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{item.name}</h2>
            <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 2 }}>
              {sideG ? "Comes with two sides" : CAT_OF[item.id]}
            </div>
          </div>
          <button className="x-btn" onClick={onClose} aria-label={`Close ${item.name} options`}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="sheet-body">
          {variants.map((g) => (
            <Group key={g.gid} label={g.name}>
              {g.mods.filter((m) => !m.oos).map((m) => {
                const i = g.mods.indexOf(m);
                return (
                  <Option key={m.n + i} sel={sel[g.gid] === i}
                    onClick={() => setSel((v) => ({ ...v, [g.gid]: i }))}
                    label={m.n} right={money(m.p)} />
                );
              })}
            </Group>
          ))}

          {flavors.map((g) => (
            <Group key={g.gid} label={g.name}>
              {g.mods.map((m, i) => (
                <Option key={m.n + i} sel={sel[g.gid] === i}
                  onClick={() => setSel((v) => ({ ...v, [g.gid]: i }))} label={m.n} />
              ))}
            </Group>
          ))}

          {sideG && [[side1, setSide1, "Side 1"], [side2, setSide2, "Side 2"]].map(([val, set, label]) => (
            <Group key={label} label={label}>
              {sideG.mods.map((m, i) => (
                <Option key={m.n + i} sel={val === i} onClick={() => set(i)}
                  label={m.n} right={m.p ? `+${money(m.p)}` : "Included"} />
              ))}
            </Group>
          ))}

          <Group label="Special instructions">
            <input className="field" placeholder="Extra gravy, no pepper, etc."
              value={note} onChange={(e) => setNote(e.target.value)} />
          </Group>

          {saves > 0 && (
            <div style={{ display: "flex", gap: 9, alignItems: "center", padding: "11px 13px", borderRadius: 13,
              background: "rgba(47,182,168,.10)", marginTop: 4 }}>
              <Sparkles size={16} color="var(--teal-ink)" style={{ flex: "0 0 auto" }} />
              <div style={{ fontSize: 12.5, lineHeight: 1.4 }}>
                <strong>{money(saves)} cheaper</strong> than ordering this on Uber Eats
              </div>
            </div>
          )}
        </div>

        <div className="sheet-foot">
          <div className="stepper">
            <button className="step-b" onClick={() => setQty((q) => Math.max(1, q - 1))}><Minus size={16} /></button>
            <span style={{ minWidth: 22, textAlign: "center", fontWeight: 700 }}>{qty}</span>
            <button className="step-b" onClick={() => setQty((q) => q + 1)}><Plus size={16} /></button>
          </div>
          <button className="pill-btn" style={{ flex: 1 }} onClick={() => {
            onAdd({
              name: item.name, meta, price: unit, qty, note,
              itemId: item.id, cat: CAT_OF[item.id], plate: PLATE_IDS.has(item.id),
              modifiers: chosen,
              save: saves,
            });
          }}>
            Add · {money(unit * qty)}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- STAFF: KITCHEN / 86 CONTROL ---------- */
function StaffSheet({ soldOut, toggleSold, onClose }) {
  const outCount = soldOut.size;
  const sheetRef = useSheet(onClose);
  return (
    <div className="sheet-wrap">
      <div className="scrim" onClick={onClose} />
      <div className="sheet" ref={sheetRef} tabIndex={-1}
        role="dialog" aria-modal="true" aria-labelledby="staff-title">
        <div className="sheet-head">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Lock size={16} color="var(--orchid-ink)" aria-hidden="true" />
              <h3 className="serif" id="staff-title" style={{ fontWeight: 700, fontSize: 22, margin: 0 }}>Kitchen</h3>
            </div>
            <p style={{ color: "var(--muted)", fontSize: 13, margin: "6px 0 0" }}>
              Flip an item off and it disappears from the customer app instantly. Flip it back on when you restock.
            </p>
          </div>
          <button className="x-btn" onClick={onClose} aria-label="Close kitchen controls">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div style={{ margin: "10px 18px 4px", padding: "10px 14px", borderRadius: 12, flex: "0 0 auto",
          background: outCount ? "rgba(232,154,199,.14)" : "rgba(127,185,62,.12)",
          color: outCount ? "var(--rose-ink)" : "var(--leaf-ink)", fontSize: 13, fontWeight: 600 }}>
          {outCount ? `${outCount} item${outCount > 1 ? "s" : ""} marked sold out today` : "Everything in stock"}
        </div>

        <div className="sheet-body" style={{ padding: "6px 14px 24px" }}>
          {MENU.map((c) => (
            <div key={c.cat} style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: .5, margin: "4px 6px 8px" }}>{c.cat}</div>
              {c.items.map((it) => {
                const out = soldOut.has(it.id);
                return (
                  <div key={it.id} onClick={() => toggleSold(it.id)}
                    role="switch" aria-checked={!out} tabIndex={0}
                    aria-label={`${it.name}, ${out ? "sold out" : "in stock"}`}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault(); toggleSold(it.id);
                    }}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px",
                      border: "1px solid var(--line)", borderRadius: 14, marginBottom: 8, cursor: "pointer",
                      background: out ? "rgba(58,46,69,.03)" : "#fff" }}>
                    <span style={{ fontWeight: 600, fontSize: 14.5, color: out ? "var(--muted)" : "var(--ink)", textDecoration: out ? "line-through" : "none", display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                      {it.name}
                      {it.days && <span style={{ fontSize: 10, fontWeight: 700, color: "var(--plum-ink)", background: "rgba(142,91,196,.14)", padding: "2px 6px", borderRadius: 999 }}>{daysLabel(it.days).toUpperCase()}</span>}
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: out ? "var(--rose-ink)" : "var(--leaf-ink)" }}>
                        {out ? "Sold out" : "In stock"}
                      </span>
                      <span style={{ width: 46, height: 27, borderRadius: 999, padding: 3, transition: "background .2s",
                        background: out ? "#E0879F" : "var(--leaf-ink)", display: "flex", justifyContent: out ? "flex-start" : "flex-end" }}>
                        <span style={{ width: 21, height: 21, borderRadius: 999, background: "#fff" }} />
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- CART ---------- */
function CartView({ cart, subtotal, saved, account, setQty, removeLine, setView,
  vouchers, applied, appliedVoucher, discount, applyVoucher, clearVoucher }) {
  return (
    <>
      <SubHeader title="Your Order" />
      {cart.length === 0 ? (
        <Empty icon={<ShoppingBag size={30} />} title="Your cart is empty"
          text="Add something from the menu and skip the line." cta="Browse menu" onCta={() => setView("menu")} />
      ) : (
        <div style={{ padding: "4px 16px 20px" }}>
          {cart.map((l) => (
            <div key={l.key} className="card" style={{ padding: 14, marginBottom: 12, display: "flex", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{l.name}</div>
                {l.meta && <div style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 3 }}>{l.meta}</div>}
                {l.note && <div className="note-chip" style={{ marginTop: 6 }}>Note: {l.note}</div>}
                <div className="stepper" style={{ marginTop: 10 }}>
                  <button className="step-b" onClick={() => setQty(l.key, -1)}
                    aria-label={`Decrease ${l.name} quantity`}>
                    <Minus size={15} aria-hidden="true" />
                  </button>
                  <span style={{ fontWeight: 700 }} aria-label={`${l.name} quantity`}>{l.qty}</span>
                  <button className="step-b" onClick={() => setQty(l.key, 1)}
                    aria-label={`Increase ${l.name} quantity`}>
                    <Plus size={15} aria-hidden="true" />
                  </button>
                  <button onClick={() => removeLine(l.key)} aria-label={`Remove ${l.name}`}
                    style={{ marginLeft: 6, background: "none", border: 0, color: "var(--muted)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                    Remove
                  </button>
                </div>
              </div>
              <div className="price">{money(l.price * l.qty)}</div>
            </div>
          ))}
          <div className="card" style={{ padding: 16, marginTop: 4 }}>
            <div className="rowline"><span style={{ color: "var(--muted)" }}>Subtotal</span><span style={{ fontWeight: 700 }}>{money(subtotal)}</span></div>
            {discount > 0 && (
              <div className="rowline">
                <span style={{ color: "var(--leaf-ink)", fontWeight: 600 }}>{appliedVoucher.name}</span>
                <span style={{ color: "var(--leaf-ink)", fontWeight: 700 }}>−{money(discount)}</span>
              </div>
            )}
            {account && (
              <div className="rowline"><span style={{ color: "var(--muted)" }}>You'll earn</span>
                <span style={{ color: "var(--leaf-ink)", fontWeight: 700 }}>+{Math.round(subtotal)} pts</span></div>
            )}
          </div>
          {saved > 0 && (
            <div style={{ display: "flex", gap: 9, alignItems: "center", padding: "12px 14px", borderRadius: 14,
              background: "rgba(47,182,168,.10)", marginTop: 12 }}>
              <Sparkles size={16} color="var(--teal-ink)" style={{ flex: "0 0 auto" }} />
              <div style={{ fontSize: 13, lineHeight: 1.4 }}>
                You're saving <strong>{money(saved)}</strong> ordering direct
                <div style={{ color: "var(--muted)", fontSize: 11.5 }}>Same food. No app markup.</div>
              </div>
            </div>
          )}
          {vouchers && vouchers.length > 0 && (
            <>
              <h3 className="serif" style={{ fontWeight: 700, fontSize: 16, margin: "20px 4px 10px" }}>Your rewards</h3>
              {vouchers.map((v) => {
                const r = rewardOf(v);
                const worth = discountFor(v, cart);
                const on = applied === v.code;
                return (
                  <div key={v.code} className="card" style={{ padding: 13, marginBottom: 9, display: "flex", gap: 11,
                    alignItems: "center", border: on ? "1px solid var(--leaf)" : "1px dashed var(--line)" }}>
                    <Ticket size={19} color={on ? "var(--teal-ink)" : "var(--muted)"} style={{ flex: "0 0 auto" }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{v.name}</div>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>
                        {worth > 0 ? `Saves ${money(worth)}` : `Add ${r.needs} to use`}
                      </div>
                    </div>
                    <button className="pill-btn ghost" style={{ width: "auto", padding: "8px 13px", fontSize: 12.5 }}
                      onClick={() => on ? clearVoucher() : applyVoucher(v.code)}>
                      {on ? "Remove" : "Apply"}
                    </button>
                  </div>
                );
              })}
            </>
          )}

          <button className="pill-btn" style={{ marginTop: 16 }} onClick={() => setView("checkout")}>
            Go to checkout · {money(Math.max(0, subtotal - discount))}
          </button>
        </div>
      )}
    </>
  );
}

/* ---------- CHECKOUT ---------- */
function CheckoutView({ subtotal, points, account, goJoin, discount = 0, appliedVoucher, onBack, onPay }) {
  const [name, setName] = useState(account ? account.name : "");
  const [phone, setPhone] = useState(account ? account.phone : "");
  const [tipIdx, setTipIdx] = useState(1);
  const tips = [0, 0.1, 0.15, 0.2];
  const base = Math.max(0, subtotal - discount);
  const tip = cents(subtotal * tips[tipIdx]);   // tip on pre-discount value
  const tax = cents(base * 0.08875);
  const total = cents(base + tax + tip);

  /* Pickup slots are recomputed on a one-minute tick: someone can sit on this
     screen long enough for the first slot to pass, and we must not sell a time
     that has already gone by, or a time after close. */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const open = isOpen(now);
  const slots = useMemo(() => pickupSlots(now), [now]);
  const [slotIso, setSlotIso] = useState("");        // "" = ASAP
  // If the chosen slot has drifted into the past, fall back to ASAP.
  useEffect(() => {
    if (slotIso && !slots.some((s) => s.toISOString() === slotIso)) setSlotIso("");
  }, [slots, slotIso]);

  const pickupChoice = () => (slotIso
    ? { label: formatTime(new Date(slotIso)), at: new Date(slotIso) }
    : { label: "ASAP", at: asapReadyAt(now) });

  const nameOk = isValidName(name);
  const phoneOk = isValidPhone(phone);
  const ready = nameOk && phoneOk && open && subtotal > 0;

  return (
    <>
      <SubHeader title="Checkout" onBack={onBack} />
      <div style={{ padding: "4px 16px 24px" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "12px 14px", borderRadius: 14,
          background: "rgba(47,182,168,.10)", marginTop: 4 }}>
          <MapPin size={17} color="var(--teal-ink)" style={{ flex: "0 0 auto", marginTop: 1 }} />
          <div style={{ fontSize: 13, lineHeight: 1.4 }}>
            <strong>Pickup only</strong><br />
            <span style={{ color: "var(--muted)" }}>4035 Laconia Ave, Bronx, NY 10466</span>
          </div>
        </div>

        <Section title="Pickup details">
          <input className="field" placeholder="Name" aria-label="Name" autoComplete="name"
            value={name} onChange={(e) => setName(e.target.value)} style={{ marginBottom: 10 }} />
          <input className="field" placeholder="Phone (for your ready text)" aria-label="Phone number"
            autoComplete="tel" value={phone}
            onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
        </Section>

        <Section title="Pickup time">
          {open ? (
            <>
              <button className={`slot-asap ${slotIso === "" ? "on" : ""}`} onClick={() => setSlotIso("")}
                aria-pressed={slotIso === ""}>
                <Clock size={17} aria-hidden="true" />
                <span>
                  <strong>ASAP (~15 min)</strong>
                  <span style={{ display: "block", fontSize: 12, opacity: .85 }}>
                    Ready around {formatTime(asapReadyAt(now))}
                  </span>
                </span>
                {slotIso === "" && <Check size={17} style={{ marginLeft: "auto" }} aria-hidden="true" />}
              </button>

              <label htmlFor="slot" className="slot-label">Or schedule it</label>
              <select id="slot" className="field" value={slotIso}
                onChange={(e) => setSlotIso(e.target.value)}>
                <option value="">ASAP (~15 min)</option>
                {slots.map((s) => {
                  const iso = s.toISOString();
                  return <option key={iso} value={iso}>{formatTime(s)}</option>;
                })}
              </select>
              <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
                {slots.length
                  ? `${slots.length} pickup time${slots.length > 1 ? "s" : ""} left today · kitchen closes at ${formatTime(closingOn(now))}`
                  : "No scheduled times left today — ASAP only."}
              </div>
            </>
          ) : (
            <div className="closed-card" role="status">
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>We're closed right now</div>
              <div style={{ fontSize: 13.5, lineHeight: 1.45 }}>
                Flourish opens {describeOpening(nextOpening(now), now)}. Your cart will still be
                here — nothing is lost.
              </div>
              <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>{HOURS_LINE}</div>
            </div>
          )}
        </Section>

        <Section title="Add a tip">
          <div style={{ display: "flex", gap: 8 }}>
            {tips.map((t, i) => (
              <button key={i} className={`chip ${tipIdx === i ? "on" : ""}`} style={{ flex: 1, textAlign: "center" }}
                onClick={() => setTipIdx(i)}>{t === 0 ? "None" : `${t * 100}%`}</button>
            ))}
          </div>
        </Section>

        <div className="card" style={{ padding: 16, marginTop: 6 }}>
          <div className="rowline"><span style={{ color: "var(--muted)" }}>Subtotal</span><span>{money(subtotal)}</span></div>
          {discount > 0 && (
            <div className="rowline">
              <span style={{ color: "var(--leaf-ink)", fontWeight: 600 }}>{appliedVoucher.name}</span>
              <span style={{ color: "var(--leaf-ink)", fontWeight: 700 }}>−{money(discount)}</span>
            </div>
          )}
          <div className="rowline"><span style={{ color: "var(--muted)" }}>Tax</span><span>{money(tax)}</span></div>
          <div className="rowline"><span style={{ color: "var(--muted)" }}>Tip</span><span>{money(tip)}</span></div>
          <div style={{ borderTop: "1px solid var(--line)", margin: "8px 0" }} />
          <div className="rowline" style={{ fontWeight: 700, fontSize: 16 }}><span>Total</span><span>{money(total)}</span></div>
          {account && (
            <div className="rowline" style={{ marginTop: 4 }}>
              <span style={{ color: "var(--muted)" }}>You'll earn</span>
              <span style={{ color: "var(--leaf-ink)", fontWeight: 700 }}>+{Math.round(subtotal)} pts</span>
            </div>
          )}
        </div>

        {!account && (
          <button className="card" onClick={goJoin}
            style={{ padding: 14, marginTop: 12, width: "100%", display: "flex", gap: 11, alignItems: "center",
              textAlign: "left", border: "1px dashed var(--leaf)", cursor: "pointer", font: "inherit" }}>
            <Award size={20} color="var(--teal-ink)" style={{ flex: "0 0 auto" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Earn {Math.round(subtotal)} points on this order</div>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>Join free. Takes a few seconds.</div>
            </div>
            <ChevronRight size={17} color="var(--muted)" />
          </button>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "14px 4px", color: "var(--muted)", fontSize: 12.5 }}>
          <div style={{ width: 20, height: 20, borderRadius: 6, background: "#000", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}></div>
          Pay with Apple Pay, Google Pay, or card at checkout
        </div>

        <button className="pill-btn" disabled={!ready} onClick={() => onPay(pickupChoice(), tip)}>
          {!open ? `Closed until ${formatTime(nextOpening(now))}`
            : ready ? `Pay ${money(total)}`
            : !nameOk ? "Enter your name"
            : "Enter your phone number"}
        </button>
        <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 11, marginTop: 10 }}>
          Demo checkout · live version charges through Clover
        </div>
      </div>
    </>
  );
}

/* ---------- ORDER CONFIRMATION + TRACKING ---------- */
/* Everything a customer needs after paying, without leaving the screen:
   what they ordered, when it's ready, where to go, and how to call. */
function TrackView({ order, setView }) {
  const steps = ["Order received", "In the kitchen", "Ready for pickup"];
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const t1 = setTimeout(() => setStage(1), 2200);
    const t2 = setTimeout(() => setStage(2), 6000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const readyAt = order.readyAt ? new Date(order.readyAt) : null;
  const itemCount = order.lines.reduce((n, l) => n + l.qty, 0);

  return (
    <>
      <header className="hdr" style={{ paddingBottom: 20 }}>
        <Hummingbird style={{ top: 6, right: -4 }} size={50} flip />
        <button onClick={() => setView("menu")} className="linkback" aria-label="Done, back to menu">
          <ChevronLeft size={18} aria-hidden="true" /> Done
        </button>
        <div className="confirm-tick" aria-hidden="true"><Check size={26} strokeWidth={3} /></div>
        <div className="wordmark" style={{ fontSize: 34 }}>Order confirmed</div>
        <div style={{ color: "var(--muted)", fontWeight: 600, marginTop: 4, fontSize: 14 }}>
          Order <strong style={{ color: "var(--ink)" }}>{order.num}</strong> · {itemCount} item{itemCount > 1 ? "s" : ""}
        </div>
      </header>

      <div style={{ padding: 20 }}>
        {/* ready time */}
        <div className="card ready-card" style={{ padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Clock size={22} color="var(--orchid-ink)" style={{ flex: "0 0 auto" }} aria-hidden="true" />
            <div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }}>Estimated ready time</div>
              <div className="serif" style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.15 }}>
                {readyAt ? formatTime(readyAt) : "~15 min"}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                {order.pickup === "ASAP" ? "About 15 minutes from now" : `Scheduled pickup · ${order.pickup}`}
              </div>
            </div>
          </div>
        </div>

        {/* live status */}
        <div className="card" style={{ padding: 20, marginTop: 14 }}>
          {steps.map((s, i) => (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 0" }}>
              <span className={`status-dot ${i <= stage ? "on" : ""}`} aria-hidden="true" />
              <span style={{ fontWeight: i === stage ? 700 : 500, color: i <= stage ? "var(--ink)" : "var(--muted)" }}>{s}</span>
              {i === 2 && stage === 2 && <span className="badge" style={{ marginLeft: "auto" }}>Ready now</span>}
            </div>
          ))}
          <div style={{ borderTop: "1px solid var(--line)", margin: "12px 0" }} />
          <div style={{ color: "var(--muted)", fontSize: 13 }} aria-live="polite">
            {stage < 2 ? "We'll text you the moment it's ready." : "Come grab it at 4035 Laconia Ave 🌺"}
          </div>
        </div>

        {/* what they ordered — notes included, this is the kitchen ticket */}
        <h3 className="serif" style={{ fontWeight: 700, fontSize: 17, margin: "22px 4px 10px" }}>Your order</h3>
        <div className="card" style={{ padding: 16 }}>
          {order.lines.map((l, i) => (
            <div key={i} style={{ padding: "7px 0" }}>
              <div className="rowline" style={{ padding: 0 }}>
                <span style={{ fontWeight: 600 }}>{l.qty}× {l.name}</span>
                <span style={{ fontWeight: 600 }}>{money(l.price * l.qty)}</span>
              </div>
              {l.meta && <div style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 2 }}>{l.meta}</div>}
              {l.note && <div className="note-chip" style={{ marginTop: 5 }}>Note: {l.note}</div>}
            </div>
          ))}
          {order.reward && (
            <div className="rowline">
              <span style={{ color: "var(--leaf-ink)", fontWeight: 600 }}>{order.reward.name}</span>
              <span style={{ color: "var(--leaf-ink)", fontWeight: 700 }}>−{money(order.reward.amount)}</span>
            </div>
          )}
          <div style={{ borderTop: "1px solid var(--line)", margin: "8px 0" }} />
          <div className="rowline" style={{ fontWeight: 700 }}><span>Total paid</span><span>{money(order.total)}</span></div>
        </div>

        {/* where to go */}
        <h3 className="serif" style={{ fontWeight: 700, fontSize: 17, margin: "22px 4px 10px" }}>Pickup</h3>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
            <MapPin size={18} color="var(--teal-ink)" style={{ flex: "0 0 auto", marginTop: 2 }} aria-hidden="true" />
            <div style={{ fontSize: 14, lineHeight: 1.45 }}>
              <div style={{ fontWeight: 700 }}>Flourish BX</div>
              <div style={{ color: "var(--muted)" }}>4035 Laconia Ave<br />Bronx, NY 10466</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 11, alignItems: "center", marginTop: 12 }}>
            <Phone size={18} color="var(--teal-ink)" style={{ flex: "0 0 auto" }} aria-hidden="true" />
            <a href={`tel:${PHONE_E164}`} style={{ fontSize: 14, fontWeight: 600, color: "var(--orchid-ink)" }}>
              {PHONE_HUMAN}
            </a>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <a href={`tel:${PHONE_E164}`} className="pill-btn ghost linkbtn"
              aria-label={`Call the restaurant at ${PHONE_HUMAN}`}>
              <Phone size={16} aria-hidden="true" /> Call restaurant
            </a>
            <a href={MAPS_URL} target="_blank" rel="noreferrer" className="pill-btn linkbtn"
              aria-label="Open 4035 Laconia Avenue in Google Maps">
              <Navigation size={16} aria-hidden="true" /> Directions
            </a>
          </div>
        </div>

        <button className="pill-btn ghost" style={{ marginTop: 16 }} onClick={() => setView("menu")}>
          Back to menu
        </button>
      </div>
    </>
  );
}

/* ---------- REWARDS ---------- */
function SignInView({ onSignIn }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const clean = phone.replace(/\D/g, "");
  const ok = name.trim().length > 1 && clean.length === 10;
  return (
    <>
      <SubHeader title="Sign in" />
      <div style={{ padding: "4px 16px 24px" }}>
        <div className="reward-card" style={{ textAlign: "center" }}>
          <Hummingbird style={{ top: -6, right: -6, opacity: .35 }} size={70} flip />
          <Award size={30} style={{ marginBottom: 6 }} />
          <div className="serif" style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}>Join Flourish Rewards</div>
          <div style={{ fontSize: 13, opacity: .95, marginTop: 6, lineHeight: 1.45 }}>
            Earn a point for every dollar. Free sides, free drinks, free plates.
          </div>
        </div>

        <Section title="Your details">
          <input className="field" placeholder="Full name" value={name}
            onChange={(e) => setName(e.target.value)} style={{ marginBottom: 10 }} />
          <input className="field" placeholder="Phone number" inputMode="tel" value={phone}
            onChange={(e) => setPhone(e.target.value)} />
        </Section>
        <div style={{ color: "var(--muted)", fontSize: 11.5, margin: "10px 2px 0", lineHeight: 1.45 }}>
          We use your number to look up your points and text you when your order is ready. Nothing else.
        </div>

        <button className="pill-btn" style={{ marginTop: 16, opacity: ok ? 1 : .5 }} disabled={!ok}
          onClick={() => onSignIn(name.trim(), clean)}>
          Create my account
        </button>

        <h3 className="serif" style={{ fontWeight: 700, fontSize: 18, margin: "26px 4px 10px" }}>What you unlock</h3>
        {REWARDS.map((r) => (
          <div key={r.id} className="card" style={{ padding: 14, marginBottom: 10, display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, flex: "0 0 auto",
              background: "linear-gradient(135deg,var(--leaf-lt),var(--teal))", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Gift size={19} color="#fff" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>{r.name}</div>
              <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{r.cost} pts · {r.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------- REWARDS / ACCOUNT ---------- */
function RewardsView({ account, points, vouchers, orders, redeem, signOut, onReorder }) {
  const [shared, setShared] = useState(null);   // null | "shared" | "copied"
  const tier = tierFor(points);
  const next = nextTier(points);
  const pct = next ? Math.min(100, ((points - tier.min) / (next.min - tier.min)) * 100) : 100;
  const usual = orders[0];
  const spent = orders.reduce((t, o) => t + o.total, 0);

  return (
    <>
      <SubHeader title="Rewards" />
      <div style={{ padding: "4px 16px 24px" }}>

        <div className="card" style={{ padding: 16, marginBottom: 18, borderRadius: 22, border: "1px solid var(--line)", background: "#fff" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, opacity: .9 }}>{account.name}</div>
              <div className="serif" style={{ fontSize: 44, fontWeight: 700, lineHeight: 1.1 }}>{points}</div>
              <div style={{ fontSize: 12.5, opacity: .9, marginTop: -2 }}>points available</div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: .5, background: "rgba(255,255,255,.22)",
              padding: "5px 10px", borderRadius: 999 }}>{tier.name.toUpperCase()}</span>
          </div>
          <div className="progress" style={{ margin: "14px 0 8px" }}><span style={{ width: `${pct}%` }} /></div>
          <div style={{ fontSize: 12.5, opacity: .95 }}>
            {next ? `${next.min - points} pts to ${next.name}` : "Top tier. Thank you for the love 🌺"}
          </div>
        </div>
        <div className="card" style={{ padding: 16, marginBottom: 18, borderRadius: 22, border: "1px solid var(--line)", background: "#fff" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <Share2 size={20} color="var(--leaf-ink)" aria-hidden="true" />
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Tell someone</div>
              <div style={{ color: "var(--muted)", fontSize: 13 }}>
                The more people order direct, the less the delivery apps take.
              </div>
            </div>
          </div>
          <button className="pill-btn ghost" style={{ width: "100%", color: "var(--ink)", padding: "14px 16px", fontWeight: 700 }}
            onClick={() => shareFlourish().then(setShared).then(() => setTimeout(() => setShared(null), 1800))}>
            {shared === "shared" ? "Thanks for sharing"
              : shared === "copied" ? "Copied to clipboard"
              : "Share Flourish"}
          </button>
        </div>

        {/* active vouchers */}
        {vouchers.length > 0 && (
          <>
            <h3 className="serif" style={{ fontWeight: 700, fontSize: 18, margin: "22px 4px 10px" }}>Ready to use</h3>
            {vouchers.map((v) => (
              <div key={v.code} className="card" style={{ padding: 14, marginBottom: 10, display: "flex", gap: 12,
                alignItems: "center", border: "1px dashed var(--leaf)" }}>
                <Ticket size={20} color="var(--teal-ink)" style={{ flex: "0 0 auto" }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>{v.name}</div>
                  <div style={{ color: "var(--muted)", fontSize: 12 }}>Show code <strong>{v.code}</strong> at pickup</div>
                </div>
              </div>
            ))}
          </>
        )}

        {/* redeem */}
        <h3 className="serif" style={{ fontWeight: 700, fontSize: 18, margin: "22px 4px 10px" }}>Redeem points</h3>
        {REWARDS.map((r) => {
          const can = points >= r.cost;
          return (
            <div key={r.id} className="card" style={{ padding: 14, marginBottom: 10, display: "flex", gap: 12,
              alignItems: "center", opacity: can ? 1 : .55 }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, flex: "0 0 auto",
                background: can ? "linear-gradient(135deg,var(--leaf-lt),var(--teal))" : "var(--line)",
                display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Gift size={19} color={can ? "#fff" : "var(--muted)"} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5 }}>{r.name}</div>
                <div style={{ color: "var(--muted)", fontSize: 12.5 }}>
                  {can ? r.desc : `${r.cost - points} more pts`}
                </div>
              </div>
              <button className="pill-btn ghost" style={{ width: "auto", padding: "8px 14px", fontSize: 13 }}
                disabled={!can} onClick={() => redeem(r)}>
                {r.cost} pts
              </button>
            </div>
          );
        })}

        {/* your usual */}
        {usual && (
          <>
            <h3 className="serif" style={{ fontWeight: 700, fontSize: 18, margin: "22px 4px 10px" }}>Your usual</h3>
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontWeight: 700 }}>{usual.lines.map((l) => l.name).join(", ")}</div>
              <button className="pill-btn" style={{ marginTop: 12 }} onClick={() => onReorder(usual)}>
                <RotateCcw size={15} style={{ verticalAlign: -2, marginRight: 6 }} /> Reorder
              </button>
            </div>
          </>
        )}

        {/* account */}
        <h3 className="serif" style={{ fontWeight: 700, fontSize: 18, margin: "22px 4px 10px" }}>Account</h3>
        <div className="card" style={{ padding: 16 }}>
          {[["Name", account.name],
            ["Phone", account.phone.replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3")],
            ["Member since", account.since],
            ["Orders", String(orders.length)],
            ["Lifetime spend", money(spent)]].map(([k, v]) => (
            <div key={k} className="rowline">
              <span style={{ color: "var(--muted)" }}>{k}</span><span style={{ fontWeight: 600 }}>{v}</span>
            </div>
          ))}
          <button className="pill-btn ghost" style={{ marginTop: 14 }} onClick={signOut}>
            <LogOut size={15} style={{ verticalAlign: -2, marginRight: 6 }} /> Sign out
          </button>
        </div>

        <div style={{ color: "var(--muted)", fontSize: 11.5, textAlign: "center", padding: "16px 20px 0", lineHeight: 1.5 }}>
          Earn 1 point per $1 spent. Points never expire.
        </div>
      </div>
    </>
  );
}

/* ---------- ORDERS ---------- */
function OrdersView({ orders, onReorder, onBrowse }) {
  return (
    <>
      <SubHeader title="Your Orders" />
      <div style={{ padding: "4px 16px 24px" }}>
        {orders.length === 0 && (
          <Empty icon={<Receipt size={30} />} title="No orders yet"
            text="Your past pickups will show up here, ready to reorder in one tap."
            cta="Start your first order" onCta={onBrowse} />
        )}
        {orders.map((o) => (
          <div key={o.num} className="card" style={{ padding: 16, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700 }}>{o.num}</div>
                <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{o.when} · {money(o.total)}</div>
              </div>
              <span className="badge" style={o.status !== "done" ? {} : { background: "rgba(142,91,196,.1)", color: "var(--orchid-ink)" }}>
                {o.status === "preparing" ? "Preparing" : "Completed"}
              </span>
            </div>
            <div style={{ margin: "10px 0" }}>
              {o.lines.map((l, i) => (
                <div key={i} style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}>
                  {l.qty}× {l.name}{l.meta ? ` · ${l.meta}` : ""}
                  {l.note && <span className="note-chip" style={{ marginLeft: 6 }}>{l.note}</span>}
                </div>
              ))}
            </div>
            <button className="pill-btn ghost" onClick={() => onReorder(o)}
              aria-label={`Reorder ${o.num}`}>
              <RotateCcw size={15} style={{ verticalAlign: -2, marginRight: 6 }} aria-hidden="true" /> Reorder
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------- SHARED ---------- */
/* Modal plumbing shared by the item sheet and the staff sheet: Escape closes,
   focus moves into the sheet on open and back to where it was on close, and
   Tab is kept inside while it's up. */
function useSheet(onClose) {
  const ref = useRef(null);
  useEffect(() => {
    const opener = document.activeElement;
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab") return;
      const f = ref.current?.querySelectorAll(
        'button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!f?.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    // Don't steal focus onto the close button — put it on the sheet itself.
    ref.current?.focus?.({ preventScroll: true });
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (opener instanceof HTMLElement) opener.focus?.({ preventScroll: true });
    };
  }, [onClose]);
  return ref;
}

function SubHeader({ title, onBack }) {
  return (
    <header className="hdr" style={{ paddingBottom: 18 }}>
      <Hummingbird style={{ top: 4, right: -6 }} size={46} flip />
      {onBack && (
        <button onClick={onBack} style={{ background: "none", border: 0, color: "var(--orchid-ink)", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 3, marginBottom: 6, padding: 0 }}>
          <ChevronLeft size={18} /> Back
        </button>
      )}
      <h1 className="serif" style={{ fontWeight: 700, fontSize: 27, margin: 0 }}>{title}</h1>
    </header>
  );
}
/* Labelled block inside the item sheet (a Clover modifier group). */
const Group = ({ label, children }) => (
  <div style={{ marginBottom: 18 }}>
    <div style={{ fontWeight: 700, fontSize: 13.5, letterSpacing: .2, margin: "0 2px 9px", color: "var(--ink)" }}>
      {label}
    </div>
    {children}
  </div>
);

/* One selectable modifier. `right` shows its price or "Included". */
const Option = ({ sel, onClick, label, right }) => (
  <div className={"opt" + (sel ? " sel" : "")} onClick={onClick} role="button" tabIndex={0}
    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}>
    <span style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
      <span className="radio">{sel && <Check size={12} color="#fff" strokeWidth={3} />}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
    </span>
    {right && <span style={{ color: "var(--muted)", fontSize: 13, flex: "0 0 auto", marginLeft: 10 }}>{right}</span>}
  </div>
);

const Section = ({ title, children }) => (
  <div style={{ marginTop: 18 }}>
    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>{title}</div>
    {children}
  </div>
);
function Empty({ icon, title, text, cta, onCta }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 30px" }}>
      <div style={{ width: 68, height: 68, borderRadius: 20, margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center",
        background: "linear-gradient(135deg,var(--pink-lt),var(--leaf-lt))", color: "#fff" }}>{icon}</div>
      <div className="serif" style={{ fontWeight: 700, fontSize: 20 }}>{title}</div>
      <div style={{ color: "var(--muted)", fontSize: 14, marginTop: 6 }}>{text}</div>
      {cta && <button className="pill-btn" style={{ marginTop: 20, maxWidth: 220 }} onClick={onCta}>{cta}</button>}
    </div>
  );
}
