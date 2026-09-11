import React, { useState, useEffect } from "react";
import { ShoppingBag, Plus, Minus, Sparkles, Ticket, Clock } from "lucide-react";
import { money } from "../lib/money.js";
import { cleanLineNote, LINE_NOTE_MAX } from "../lib/cloverOrder.js";
import { rewardOf, discountFor } from "../lib/loyalty.js";
import { isOpen, nextOpening, describeOpening, HOURS_LINE } from "../lib/hours.js";
import { cartPrepMinutes, isCookedToOrder, COOKED_TO_ORDER_MINUTES } from "../lib/prep.js";
import { SubHeader, Empty } from "./shared.jsx";

/* ---------- CART ---------- */
export default function CartView({ cart, subtotal, saved, account, setQty, removeLine, setView,
  vouchers, applied, appliedVoucher, discount, applyVoucher, clearVoucher, quote = null,
  setNote }) {
  /* Say it here rather than letting someone build an order, walk to checkout
     and only then find out. Re-checked on a minute tick so a cart left open
     across closing time notices. */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  const open = isOpen(now);

  /* Which line's instructions are being edited, and the text so far. Held here
     rather than per-row so only one is ever open. */
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");
  const commit = (key) => {
    setNote?.(key, cleanLineNote(draft));
    setEditing(null);
  };

  /* Which lines are the reason this order takes as long as it does. Working out
     *which* item is slow is a display question and stays here; how long the
     order actually needs is the server's answer (`quote`), never this one. */
  const slowLines = cart.filter((l) => isCookedToOrder(l.itemId));
  const pushedOut = slowLines.length > 0 && cartPrepMinutes(cart) >= COOKED_TO_ORDER_MINUTES;

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
                {/* Editable in place. It used to be a read-only chip, so changing
                    "no veg" to "no pepper" meant removing the line and
                    rebuilding the whole item from the sheet. */}
                {editing === l.key ? (
                  <div style={{ marginTop: 6 }}>
                    <input className="field" autoFocus
                      aria-label={`Special instructions for ${l.name}`}
                      placeholder="gravy on the rice, no veg, extra spicy"
                      maxLength={LINE_NOTE_MAX}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); commit(l.key); }
                        if (e.key === "Escape") { e.preventDefault(); setEditing(null); }
                      }}
                      onBlur={() => commit(l.key)} />
                    <div className="field-hint">
                      Prints on the kitchen ticket under this item.
                      {draft.length > 100 && (
                        <span style={{ float: "right", fontWeight: 700,
                          color: draft.length >= LINE_NOTE_MAX ? "var(--rose-ink)" : "var(--muted)" }}>
                          {LINE_NOTE_MAX - draft.length} left
                        </span>
                      )}
                    </div>
                    <div className="field-hint">For allergies, please call the restaurant.</div>
                  </div>
                ) : (
                  <button onClick={() => { setEditing(l.key); setDraft(l.note ?? ""); }}
                    className="note-chip"
                    aria-label={l.note
                      ? `Edit special instructions for ${l.name}: ${l.note}`
                      : `Add special instructions for ${l.name}`}
                    style={{ marginTop: 6, border: 0, font: "inherit", cursor: "pointer",
                      textAlign: "left", display: "block" }}>
                    {l.note ? `Note: ${l.note}` : "+ Add special instructions"}
                  </button>
                )}
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
              <div className="rowline"><span style={{ color: "var(--muted)" }}>You'll earn when you pay</span>
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

          {open && (
            <div style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "12px 14px",
              borderRadius: 14, background: "rgba(47,182,168,.10)", marginTop: 14 }}>
              <Clock size={16} color="var(--teal-ink)" style={{ flex: "0 0 auto", marginTop: 2 }} aria-hidden="true" />
              <div style={{ fontSize: 13, lineHeight: 1.45 }} aria-live="polite">
                {quote
                  ? <>Ready <strong>{quote.label}</strong></>
                  : "Working out when this will be ready…"}
                {pushedOut && (
                  <div style={{ color: "var(--muted)", fontSize: 11.5, marginTop: 3 }}>
                    {slowLines.length === 1
                      ? `${slowLines[0].name} is cooked to order, so this one takes longer.`
                      : "Some of these are cooked to order, so this one takes longer."}
                  </div>
                )}
                {quote && quote.fitsBeforeClose === false && (
                  <div className="field-hint bad" style={{ marginTop: 4 }}>
                    There isn't time to cook this before we close today.
                  </div>
                )}
              </div>
            </div>
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

          <button className="pill-btn" style={{ marginTop: 16 }}
            disabled={!open || quote?.fitsBeforeClose === false}
            onClick={() => open && setView("checkout")}>
            {!open ? "Closed — order when we open"
              : quote?.fitsBeforeClose === false ? "Not enough time to cook this today"
              : `Go to checkout · ${money(Math.max(0, subtotal - discount))}`}
          </button>
        </div>
      )}
    </>
  );
}
