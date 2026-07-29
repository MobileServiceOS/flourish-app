import React, { useState, useEffect } from "react";
import { ShoppingBag, Plus, Minus, Sparkles, Ticket, Clock } from "lucide-react";
import { money } from "../lib/money.js";
import { rewardOf, discountFor } from "../lib/loyalty.js";
import { isOpen, nextOpening, describeOpening, HOURS_LINE } from "../lib/hours.js";
import { SubHeader, Empty } from "./shared.jsx";

/* ---------- CART ---------- */
export default function CartView({ cart, subtotal, saved, account, setQty, removeLine, setView,
  vouchers, applied, appliedVoucher, discount, applyVoucher, clearVoucher }) {
  /* Say it here rather than letting someone build an order, walk to checkout
     and only then find out. Re-checked on a minute tick so a cart left open
     across closing time notices. */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const open = isOpen(now);

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
                      aria-label={`${on ? "Remove" : "Apply"} reward ${v.name}`}
                      onClick={() => on ? clearVoucher() : applyVoucher(v.code)}>
                      {on ? "Remove" : "Apply"}
                    </button>
                  </div>
                );
              })}
            </>
          )}

          {!open && (
            <div className="closed-card" role="status" style={{ marginTop: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, fontWeight: 700, fontSize: 15 }}>
                <Clock size={17} aria-hidden="true" /> We're closed right now
              </div>
              <div style={{ fontSize: 13.5, lineHeight: 1.45, marginTop: 6 }}>
                Flourish opens {describeOpening(nextOpening(now), now)}. Your cart keeps
                everything in it until then.
              </div>
              <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>{HOURS_LINE}</div>
            </div>
          )}

          <button className="pill-btn" style={{ marginTop: 16 }} disabled={!open}
            onClick={() => open && setView("checkout")}>
            {open
              ? `Go to checkout · ${money(Math.max(0, subtotal - discount))}`
              : "Closed — order when we open"}
          </button>
        </div>
      )}
    </>
  );
}
