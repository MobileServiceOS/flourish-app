import React, { useState } from "react";
import { Gift, LogOut, Ticket, RotateCcw, Share2 } from "lucide-react";
import { money } from "../lib/money.js";
import { REWARDS, tierFor, nextTier } from "../lib/loyalty.js";
import { formatPhone } from "../lib/phone.js";
import { shareFlourish } from "../lib/share.js";
import { SubHeader } from "./shared.jsx";

/* ---------- REWARDS / ACCOUNT ---------- */
export default function RewardsView({ account, points, vouchers, orders, redeem, signOut, onReorder }) {
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
            ["Phone", formatPhone(account.phone)],
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
