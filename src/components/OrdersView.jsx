import React from "react";
import { Receipt, RotateCcw } from "lucide-react";
import { money } from "../lib/money.js";
import { SubHeader, Empty } from "./shared.jsx";

/* What an order's badge says. One place, so the list and anything else that
   needs it cannot disagree.

   "Paid" rather than "Completed": the app knows the register took the money,
   which is not the same as the customer having collected the food, and saying
   the stronger thing would be inventing a fact. */
export function orderBadge(o) {
  if (o?.status === "cancelled" || o?.paidBy === "voided") return "Cancelled";
  if (o?.status === "paid" || o?.paidBy === "paid" || o?.pointsAwarded) return "Paid";
  if (o?.status === "done") return "Completed";
  return "Preparing";
}

export const badgeStyle = (o) => {
  const label = orderBadge(o);
  if (label === "Cancelled") return { background: "rgba(232,154,199,.22)", color: "var(--rose-ink)" };
  if (label === "Preparing") return {};
  return { background: "rgba(142,91,196,.1)", color: "var(--orchid-ink)" };
};

/* ---------- ORDERS ---------- */
export default function OrdersView({ orders, onReorder, onBrowse, onOpen }) {
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
            {/* The whole card opens the detail. A summary is enough until
                something is wrong, and then the customer needs every line, the
                totals and the ids — see OrderDetail. */}
            <div role="button" tabIndex={0}
              aria-label={`Order ${o.num}, ${o.when}, ${money(o.total)} — see details`}
              onClick={() => onOpen?.(o)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen?.(o); } }}
              style={{ cursor: "pointer" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 700 }}>{o.num}</div>
                <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{o.when} · {money(o.total)}</div>
              </div>
              {/* Derived from the order's own fields rather than from `status`
                  alone, because that field was written once at creation and
                  updated by nothing — so every order ever placed read
                  "Preparing", including one paid for four minutes earlier.

                  It is written now (see awardPoints and markVoided), and this
                  reads `paidBy` alongside it so an order recorded as paid by an
                  older build still shows correctly. */}
              <span className="badge" style={badgeStyle(o)}>{orderBadge(o)}</span>
            </div>
            <div style={{ margin: "10px 0" }}>
              {o.lines.map((l, i) => (
                <div key={i} style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}>
                  {l.qty}× {l.name}{l.meta ? ` · ${l.meta}` : ""}
                  {l.note && <span className="note-chip" style={{ marginLeft: 6 }}>{l.note}</span>}
                </div>
              ))}
            </div>
            </div>
            {/* Outside the clickable region: tapping Reorder must reorder, not
                open the detail. Reorder stays on the list because it is the
                thing people come here to do. */}
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
