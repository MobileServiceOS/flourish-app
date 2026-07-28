import React from "react";
import { X, Lock } from "lucide-react";
import { MENU } from "../data/menu.data.js";
import { daysLabel } from "../lib/restaurant.js";
import { useSheet } from "./shared.jsx";

/* ---------- STAFF: KITCHEN / 86 CONTROL ---------- */
export default function StaffSheet({
  soldOut, toggleSold, onClose, fromClover = new Set(), connected = false, lastSync = null,
}) {
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
              {connected
                ? "Flip an item off and it goes to the register too, so every channel sees it. Flip it back on when you restock."
                : "Flip an item off and it disappears from the customer app instantly. Not connected to the register right now, so this stays on this device."}
            </p>
            <p style={{ color: "var(--muted)", fontSize: 11.5, margin: "6px 0 0" }}>
              {connected
                ? `Stock synced from Clover${lastSync ? ` at ${lastSync.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : "…"}`
                : "Offline — local only"}
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
                        {out ? (fromClover.has(it.id) ? "Out of stock" : "Sold out") : "In stock"}
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
