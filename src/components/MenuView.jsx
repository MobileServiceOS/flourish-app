import React, { useState, useEffect, useRef } from "react";
import { Plus, Star, Clock, MapPin, X, Sparkles, Lock, ChevronRight } from "lucide-react";
import { UE, hasChoices } from "../data/menu.data.js";
import { money } from "../lib/money.js";
import { HOURS_LINE } from "../lib/hours.js";
import { DOW, TODAY_IS_FRIDAY, daysLabel, chipLabel, SEAFOOD_CAT, sizePrices } from "../lib/restaurant.js";
import { Thumb, Empty } from "./shared.jsx";

/* ---------- MENU ---------- */
export default function MenuView({ activeCat, scrollToCat, setDetail, catRefs, soldOut, openStaff, flash, quickAdd, search, setSearch, menu, sandbox = false }) {
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

  /* What a screen reader hears for a row. Mirrors what is printed: the two
     sizes when that is what the prices are, otherwise a range. */
  const priceLabel = (it, outBadge) => {
    const s = sizePrices(it);
    const price = it.lo === it.hi ? money(it.lo)
      : s ? `medium ${money(s.med)}, large ${money(s.lg)}`
      : `${money(it.lo)} to ${money(it.hi)}`;
    return [it.name, it.desc, price, outBadge?.toLowerCase()].filter(Boolean).join(", ");
  };

  // Adding an item is either one tap (no choices) or opens the sheet.
  const choose = (it, viaButton) => {
    if (quickAdd(it)) { if (viaButton) pop(it.id); return; }
    setDetail(it);
  };

  return (
    <>
      <header className="hdr">
        {/* The logo carries its own hummingbirds, so the decorative pair that
            used to sit here would only crowd it. */}
        <div className="hdr-row">
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600 }}>Order pickup from</div>
            <img className="hdr-logo" src="/logo-mark.png" alt="Flourish"
              width={168} height={111} decoding="async" fetchPriority="high" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            <button onClick={openStaff} title="Staff" aria-label="Staff: mark items sold out"
              style={{ width: 30, height: 30, borderRadius: 9, border: "1px solid var(--line)",
                background: "rgba(255,255,255,.75)", color: "var(--muted)", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Lock size={14} aria-hidden="true" />
            </button>
            {/* Disappears on its own once CLOVER_API_BASE points at
                api.clover.com — nobody has to remember to remove it. */}
            {sandbox && (
              <span className="badge sandbox" title="Connected to the Clover sandbox — test orders only">
                SANDBOX
              </span>
            )}
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
              aria-label={priceLabel(it, out ? badge : null)}
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
                    {(() => {
                      if (it.lo === it.hi) return money(it.lo);
                      // Where the two prices are just the two sizes, say so.
                      const s = sizePrices(it);
                      if (s) return (
                        <>
                          <span className="size-tag">Med</span> {money(s.med)}
                          <span style={{ color: "var(--muted)", fontWeight: 600, margin: "0 6px" }}>·</span>
                          <span className="size-tag">Lg</span> {money(s.lg)}
                        </>
                      );
                      return <>{money(it.lo)} <span style={{ color: "var(--muted)", fontWeight: 600 }}>–</span> {money(it.hi)}</>;
                    })()}
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
