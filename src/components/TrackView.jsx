import React, { useState, useEffect } from "react";
import { Clock, MapPin, Phone, ChevronLeft, Check, Navigation } from "lucide-react";
import { money } from "../lib/money.js";
import { formatTime } from "../lib/hours.js";
import { PHONE_E164, PHONE_HUMAN, MAPS_URL } from "../lib/restaurant.js";
import { Hummingbird } from "./shared.jsx";

/* ---------- ORDER CONFIRMATION + TRACKING ---------- */
/* Everything a customer needs after paying, without leaving the screen:
   what they ordered, when it's ready, where to go, and how to call. */
export default function TrackView({ order, setView }) {
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
