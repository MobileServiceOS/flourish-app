import React, { useState, useEffect, useRef } from "react";
import { Plus, Star, Clock, MapPin, X, Sparkles, Lock, ChevronRight, Car } from "lucide-react";
import { UE, FRIDAY_VS, hasChoices } from "../data/menu.data.js";
import { money } from "../lib/money.js";
import { HOURS_LINE } from "../lib/hours.js";
import { PREP_RANGE_LABEL } from "../lib/prep.js";
import {
  DOW, TODAY_IS_FRIDAY, daysLabel, chipLabel, SEAFOOD_CAT, sizePrices,
  uberComparison, fridaySaving,
} from "../lib/restaurant.js";
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

  /* Keep the highlighted chip on screen as the spy moves it.

     This moves the CHIP STRIP's own scrollLeft, and nothing else. It used to
     call `chip.scrollIntoView({ block: "nearest", inline: "center" })`, which
     is the bug that made the menu snap back to the top on iOS:
     `scrollIntoView` scrolls EVERY scrollable ancestor, not just the one you
     meant. The strip is `position: sticky`, so WebKit resolved "nearest" block
     position against the sticky offset and moved the document as well —
     mid-gesture, with `html { scroll-behavior: smooth }` making it a fight the
     user could not win. The scroll-spy changes `activeCat` continuously while
     you scroll, so this fired constantly.

     Writing `scrollLeft` on one element cannot move an ancestor, so the
     content scroll is now untouchable from here by construction. */
  useEffect(() => {
    const nav = navRef.current;
    const el = nav?.querySelector(`[data-chip=${JSON.stringify(activeCat)}]`);
    if (!nav || !el) return;

    // Centre the chip in the strip, clamped to the strip's own range.
    const centred = el.offsetLeft - (nav.clientWidth - el.offsetWidth) / 2;
    const left = Math.max(0, Math.min(centred, nav.scrollWidth - nav.clientWidth));
    if (Math.abs(nav.scrollLeft - left) < 1) return;

    try {
      if (typeof nav.scrollTo === "function") nav.scrollTo({ left, behavior: "smooth" });
      else nav.scrollLeft = left;
    } catch {
      // jsdom, and any engine without the options form, take the plain assignment.
      nav.scrollLeft = left;
    }
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
            <picture>
              <source srcSet="/logo-mark.webp" type="image/webp" />
              <img className="hdr-logo" src="/logo-mark.png" alt="Flourish"
                width={168} height={111} decoding="async" fetchPriority="high" />
            </picture>
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
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Clock size={13} /> Ready in {PREP_RANGE_LABEL}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><MapPin size={13} /> 4035 Laconia Ave</span>
        </div>
      </header>

      {/* Surfaced here, not only at checkout. Avoiding a parking ticket on
          Laconia is the reason a lot of people will use this app at all, and
          nobody discovers a checkout toggle they never reach. */}
      <div className="curbside-note">
        <Car size={16} aria-hidden="true" style={{ flex: "0 0 auto" }} />
        <span>
          <strong>Don't want to park?</strong> Choose "I'll wait in my car" at
          checkout and we'll bring it out to you.
        </span>
      </div>

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
            {/* Says what the offer IS. The old line named shrimp alongside crab
                legs and lobster under an "It's Seafood Friday!" header, which
                reads as a deal on all three — and the Friday shrimp platter is
                $1.99 DEARER than the everyday one. Crab legs and lobster are
                the real Friday prices; the rest are Friday-only dishes, which
                is a different and smaller claim. See docs/FRIDAY-PRICING.md. */}
            <span style={{ display: "block", color: "var(--muted)", fontSize: 12, marginTop: 2 }}>
              Crab legs and lobster platters at $39.99 today, plus Friday-only
              seafood dishes. Tap to see them.
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
                </div>
                {/* Named, anchored, and on its own line.

                    This was a teal "SAVE $4.00" pill sitting beside
                    "Med $20.00 · Lg $25.00", which reads as a discount off our
                    own price — the customer expects to pay $16. It also took
                    the cheaper size, so on Oxtail it claimed $4.00 off while
                    our Large is a dollar DEARER than Uber's. Nothing is shown
                    now unless the comparison can be defended, and when it is
                    shown it names Uber Eats and gives their price. */}
                {(() => {
                  const ue = uberComparison(it, UE);
                  if (!ue) return null;
                  const line = ue.perSize
                    ? ue.perSize.map((r) => `${r.label} ${money(r.theirs)}`).join(" · ")
                    : money(ue.theirs);
                  const save = ue.perSize
                    ? ue.perSize.map((r) => `${r.label} ${money(r.saving)}`).join(" · ")
                    : money(ue.saving);
                  return (
                    <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4, lineHeight: 1.35 }}>
                      Uber Eats: {line} — <strong style={{ color: "var(--teal-ink)" }}>
                        you save {save}
                      </strong> ordering direct
                    </div>
                  );
                })()}
                {(() => {
                  const fri = fridaySaving(it, FRIDAY_VS);
                  if (!fri) return null;
                  return (
                    <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 4, lineHeight: 1.35 }}>
                      {fri.basis} any other day — <strong style={{ color: "var(--teal-ink)" }}>
                        {money(fri.saving)} less today
                      </strong>
                    </div>
                  );
                })()}
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
