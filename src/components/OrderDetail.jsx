import React from "react";
import { RotateCcw, Car, Receipt, Copy } from "lucide-react";
import { money, taxOn, TAX_LABEL } from "../lib/money.js";
import { CURRENCY_MANY, currencyAmount } from "../lib/currency.js";
import { SubHeader } from "./shared.jsx";
import { orderBadge, badgeStyle } from "./OrdersView.jsx";

/* ============================================================================
   ONE PAST ORDER, IN FULL

   The list shows a summary; this is what a customer needs when something is
   wrong — every line as it was ordered, what it cost, when it was due, and the
   two ids staff can search on.

   WHERE THE NUMBERS COME FROM MATTERS HERE.

   Everything on this screen is the order as it was PLACED, read from the copy
   stored on the device — lines, sides, instructions, the pickup window, the
   curbside vehicle. That is right: it is a receipt for a thing that already
   happened, and re-deriving it from today's menu would silently restate an old
   order at today's prices.

   Two things are NOT from the device, because they change after the order is
   placed: the STATUS (paid, cancelled) and the PETALS figures. Those come from
   the server, via the same sweep that drives the list — the order record is
   updated in place when the register reports a payment, and the balance is the
   server's. A tax line is the exception worth naming: it is recomputed for
   display from the stored subtotal, because Clover applies the merchant's own
   rules and the app never sent a tax field. It is an estimate, and says so.
   ============================================================================ */

/** The subtotal as ordered: the lines, before the reward and before tax. */
const subtotalOf = (o) =>
  (o?.lines ?? []).reduce((n, l) => n + (Number(l.price) || 0) * (Number(l.qty) || 1), 0);

export default function OrderDetail({ order, onBack, onReorder, flash }) {
  if (!order) return null;

  const sub = subtotalOf(order);
  const discount = Math.max(0, Number(order.reward?.amount) || 0);
  const net = Math.max(0, sub - discount);
  const tax = taxOn(net);
  const tip = Number(order.tip) || 0;
  const label = orderBadge(order);

  const copy = async (text, what) => {
    try {
      await navigator.clipboard?.writeText?.(text);
      flash?.(`${what} copied`);
    } catch {
      /* Clipboard is blocked in plenty of contexts and this is a convenience,
         not the way the id is obtained — it is on screen either way. */
      flash?.("Couldn't copy — the id is on screen");
    }
  };

  const Row = ({ label: k, value, strong }) => (
    <div className="rowline" style={strong ? { fontWeight: 700, fontSize: 16 } : undefined}>
      <span style={strong ? undefined : { color: "var(--muted)" }}>{k}</span>
      <span>{value}</span>
    </div>
  );

  return (
    <>
      <SubHeader title={order.num} onBack={onBack} />
      <div style={{ padding: "4px 16px 28px" }}>

        <div className="card" style={{ padding: 16, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{order.num}</div>
              <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{order.when}</div>
            </div>
            <span className="badge" style={badgeStyle(order)}>{label}</span>
          </div>

          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ color: "var(--muted)", fontSize: 12.5 }}>Pickup</span>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{order.pickup ?? "—"}</span>
            {order.scheduled && <span className="badge">Scheduled</span>}
          </div>

          {/* Curbside changes what staff DO with the bag, so it is stated rather
              than left for someone to infer from the order note. */}
          {order.curbside?.vehicle && (
            <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
              <Car size={16} color="var(--teal-ink)" aria-hidden="true" style={{ flex: "0 0 auto" }} />
              <span style={{ fontSize: 13 }}>Curbside — {order.curbside.vehicle}</span>
            </div>
          )}
        </div>

        <h3 className="serif" style={{ fontWeight: 700, fontSize: 17, margin: "18px 4px 10px" }}>
          What you ordered
        </h3>
        <div className="card" style={{ padding: 16, marginBottom: 14 }}>
          {(order.lines ?? []).map((l, i) => (
            <div key={i} style={{ marginBottom: i === order.lines.length - 1 ? 0 : 12 }}>
              <div className="rowline">
                <span style={{ fontWeight: 600 }}>{l.qty}× {l.name}</span>
                <span>{money((Number(l.price) || 0) * (Number(l.qty) || 1))}</span>
              </div>
              {/* Size, flavour and sides, exactly as they were sent to the
                  kitchen — the same string that printed on the ticket. */}
              {l.meta && (
                <div style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 2, lineHeight: 1.4 }}>
                  {l.meta}
                </div>
              )}
              {l.note && (
                <div style={{ marginTop: 4 }}>
                  <span className="note-chip">{l.note}</span>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="card" style={{ padding: 16, marginBottom: 14 }}>
          <Row label="Subtotal" value={money(sub)} />
          {discount > 0 && (
            <div className="rowline">
              <span style={{ color: "var(--leaf-ink)", fontWeight: 600 }}>
                {order.reward?.name ?? "Reward"}
              </span>
              <span style={{ color: "var(--leaf-ink)", fontWeight: 700 }}>−{money(discount)}</span>
            </div>
          )}
          {/* Named an estimate because it is one: the app sends no tax field and
              Clover applies the merchant's own rules, so the register is the
              authority. Saying "Tax" flat would claim more than is known. */}
          <Row label={`Tax (${TAX_LABEL}, estimated)`} value={money(tax)} />
          {tip > 0 && <Row label="Tip" value={money(tip)} />}
          <div style={{ borderTop: "1px solid var(--line)", margin: "8px 0" }} />
          <Row label="Total" value={money(order.total ?? net + tax + tip)} strong />
          <div style={{ color: "var(--muted)", fontSize: 11.5, marginTop: 8, lineHeight: 1.45 }}>
            Paid at the register. The counter charges what Clover works out, so a
            cent may differ from the estimate above.
          </div>
        </div>

        {/* Petals: what this order gave, and what it cost. `earnable` is the
            figure recorded when the order was placed; whether it has actually
            been credited depends on the payment, which is why the wording
            changes rather than the number. */}
        {(order.earnable > 0 || discount > 0) && (
          <div className="card" style={{ padding: 16, marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>{CURRENCY_MANY}</div>
            {order.reward?.name && (
              <Row label="Reward redeemed" value={`${order.reward.name} (−${money(discount)})`} />
            )}
            {order.earnable > 0 && (
              <Row
                label={order.pointsAwarded ? "Earned" : "Earns when paid"}
                value={currencyAmount(order.earnable)}
              />
            )}
            {!order.pointsAwarded && label !== "Cancelled" && (
              <div style={{ color: "var(--muted)", fontSize: 11.5, marginTop: 6, lineHeight: 1.45 }}>
                Credited once the register confirms the payment.
              </div>
            )}
            {label === "Cancelled" && (
              <div style={{ color: "var(--muted)", fontSize: 11.5, marginTop: 6, lineHeight: 1.45 }}>
                This order was cancelled, so nothing was earned and any {CURRENCY_MANY} held
                for the reward were returned.
              </div>
            )}
          </div>
        )}

        {/* The two ids staff search on. Shown, not hidden behind a tap, because
            the moment they are needed is the moment someone is reading them out
            over a counter. */}
        <div className="card" style={{ padding: 16, marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>For staff</div>
          <button className="rowline" onClick={() => copy(order.num, "Order number")}
            aria-label={`Copy order number ${order.num}`}
            style={{ width: "100%", background: "none", border: 0, padding: 0, font: "inherit", cursor: "pointer" }}>
            <span style={{ color: "var(--muted)" }}>Order number</span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {order.num} <Copy size={13} aria-hidden="true" />
            </span>
          </button>
          {order.cloverOrderId && (
            <button className="rowline" onClick={() => copy(order.cloverOrderId, "Clover id")}
              aria-label={`Copy Clover id ${order.cloverOrderId}`}
              style={{ width: "100%", background: "none", border: 0, padding: 0, font: "inherit", cursor: "pointer" }}>
              <span style={{ color: "var(--muted)" }}>Clover id</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "ui-monospace, monospace", fontSize: 12.5 }}>
                {order.cloverOrderId} <Copy size={13} aria-hidden="true" />
              </span>
            </button>
          )}
          <Row label="Status" value={label} />
        </div>

        <button className="pill-btn ghost" onClick={() => onReorder?.(order)}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <RotateCcw size={16} aria-hidden="true" /> Order this again
        </button>
      </div>
    </>
  );
}
