import React from "react";
import { Receipt, RotateCcw } from "lucide-react";
import { money } from "../lib/money.js";
import { SubHeader, Empty } from "./shared.jsx";

/* ---------- ORDERS ---------- */
export default function OrdersView({ orders, onReorder, onBrowse }) {
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
