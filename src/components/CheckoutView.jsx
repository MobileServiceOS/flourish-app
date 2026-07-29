import React, { useState, useEffect, useMemo, useRef } from "react";
import { MapPin, Check, Clock, Award, ChevronRight, Store, AlertCircle } from "lucide-react";
import { cents, money, taxOn, TAX_LABEL } from "../lib/money.js";
import {
  isOpen, nextOpening, pickupSlots, asapReadyAt, formatTime, describeOpening,
  closingOn, formatWindow, HOURS_LINE, READY_WINDOW,
} from "../lib/hours.js";
import { formatPhone, isValidPhone, isValidName } from "../lib/phone.js";
import { SubHeader, Section } from "./shared.jsx";

/* ---------- CHECKOUT ---------- */
export default function CheckoutView({
  subtotal, points, account, goJoin, discount = 0, appliedVoucher, onBack, onPay,
  cloverStatus = "preview", cloverReason = null, submitting = false, payError = null, onClearError,
}) {
  /* Pay at pickup, always. The app takes no money — the order goes to the
     register unpaid and the customer settles at the counter. */
  const [name, setName] = useState(account ? account.name : "");
  // The account stores bare digits; show them the way they typed them.
  const [phone, setPhone] = useState(account ? formatPhone(account.phone) : "");
  const [touched, setTouched] = useState({});
  const [tipIdx, setTipIdx] = useState(1);
  const tips = [0, 0.1, 0.15, 0.2];
  const base = Math.max(0, subtotal - discount);
  const tip = cents(subtotal * tips[tipIdx]);   // tip on pre-discount value
  const tax = taxOn(base);
  const total = cents(base + tax + tip);

  /* Pickup slots are recomputed on a one-minute tick: someone can sit on this
     screen long enough for the first slot to pass, and we must not sell a time
     that has already gone by, or a time after close. */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const open = isOpen(now);
  const slots = useMemo(() => pickupSlots(now), [now]);
  const [slotIso, setSlotIso] = useState("");        // "" = ASAP
  // If the chosen slot has drifted into the past, fall back to ASAP.
  useEffect(() => {
    if (slotIso && !slots.some((s) => s.toISOString() === slotIso)) setSlotIso("");
  }, [slots, slotIso]);

  const pickupChoice = () => (slotIso
    ? { label: formatTime(new Date(slotIso)), at: new Date(slotIso) }
    : { label: "ASAP", at: asapReadyAt(now) });

  const nameOk = isValidName(name);
  const phoneOk = isValidPhone(phone);
  const ready = nameOk && phoneOk && open && subtotal > 0;

  return (
    <>
      <SubHeader title="Checkout" onBack={onBack} />
      <div style={{ padding: "4px 16px 24px" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "12px 14px", borderRadius: 14,
          background: "rgba(47,182,168,.10)", marginTop: 4 }}>
          <MapPin size={17} color="var(--teal-ink)" style={{ flex: "0 0 auto", marginTop: 1 }} />
          <div style={{ fontSize: 13, lineHeight: 1.4 }}>
            <strong>Pickup only · ready in {READY_WINDOW}</strong><br />
            <span style={{ color: "var(--muted)" }}>4035 Laconia Ave, Bronx, NY 10466</span>
          </div>
        </div>

        <Section title="Pickup details">
          <input className="field" placeholder="Name" aria-label="Name" autoComplete="name"
            value={name} onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, name: true }))}
            aria-invalid={touched.name && !nameOk ? "true" : undefined}
            aria-describedby="co-name-hint" />
          {touched.name && !nameOk && (
            <div id="co-name-hint" className="field-hint bad">Please enter at least 2 characters.</div>
          )}
          <input className="field" placeholder="(347) 859-9413" aria-label="Phone number"
            autoComplete="tel" type="tel" inputMode="tel" value={phone}
            style={{ marginTop: 12 }}
            onChange={(e) => setPhone(formatPhone(e.target.value))}
            onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
            aria-invalid={touched.phone && !phoneOk ? "true" : undefined}
            aria-describedby="co-phone-hint" />
          <div id="co-phone-hint" className={`field-hint${touched.phone && !phoneOk ? " bad" : ""}`}>
            {touched.phone && !phoneOk
              ? "We need all 10 digits so staff can reach you about this order."
              : "So staff can reach you about this order."}
          </div>
        </Section>

        <Section title="Pickup time">
          {open ? (
            <>
              <button className={`slot-asap ${slotIso === "" ? "on" : ""}`} onClick={() => setSlotIso("")}
                aria-pressed={slotIso === ""}>
                <Clock size={17} aria-hidden="true" />
                <span>
                  <strong>ASAP ({READY_WINDOW})</strong>
                  <span style={{ display: "block", fontSize: 12, opacity: .85 }}>
                    Ready {formatWindow(now)}
                  </span>
                </span>
                {slotIso === "" && <Check size={17} style={{ marginLeft: "auto" }} aria-hidden="true" />}
              </button>

              <label htmlFor="slot" className="slot-label">Or schedule it</label>
              <select id="slot" className="field" value={slotIso}
                onChange={(e) => setSlotIso(e.target.value)}>
                <option value="">{`ASAP (${READY_WINDOW})`}</option>
                {slots.map((s) => {
                  const iso = s.toISOString();
                  return <option key={iso} value={iso}>{formatTime(s)}</option>;
                })}
              </select>
              <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
                {slots.length
                  ? `${slots.length} pickup time${slots.length > 1 ? "s" : ""} left today · kitchen closes at ${formatTime(closingOn(now))}`
                  : "No scheduled times left today — ASAP only."}
              </div>
            </>
          ) : (
            <div className="closed-card" role="status">
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>We're closed right now</div>
              <div style={{ fontSize: 13.5, lineHeight: 1.45 }}>
                Flourish opens {describeOpening(nextOpening(now), now)}. Your cart will still be
                here — nothing is lost.
              </div>
              <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>{HOURS_LINE}</div>
            </div>
          )}
        </Section>

        <Section title="Add a tip">
          <div style={{ display: "flex", gap: 8 }} role="group" aria-label="Tip amount">
            {tips.map((t, i) => (
              <button key={i} className={`chip ${tipIdx === i ? "on" : ""}`} style={{ flex: 1, textAlign: "center" }}
                aria-pressed={tipIdx === i}
                aria-label={t === 0 ? "No tip" : `Tip ${t * 100} percent, ${money(cents(subtotal * t))}`}
                onClick={() => setTipIdx(i)}>{t === 0 ? "None" : `${t * 100}%`}</button>
            ))}
          </div>
        </Section>

        <div className="card" style={{ padding: 16, marginTop: 6 }}>
          <div className="rowline"><span style={{ color: "var(--muted)" }}>Subtotal</span><span>{money(subtotal)}</span></div>
          {discount > 0 && (
            <div className="rowline">
              <span style={{ color: "var(--leaf-ink)", fontWeight: 600 }}>{appliedVoucher.name}</span>
              <span style={{ color: "var(--leaf-ink)", fontWeight: 700 }}>−{money(discount)}</span>
            </div>
          )}
          <div className="rowline"><span style={{ color: "var(--muted)" }}>Tax ({TAX_LABEL})</span><span>{money(tax)}</span></div>
          <div className="rowline"><span style={{ color: "var(--muted)" }}>Tip</span><span>{money(tip)}</span></div>
          <div style={{ borderTop: "1px solid var(--line)", margin: "8px 0" }} />
          <div className="rowline" style={{ fontWeight: 700, fontSize: 16 }}><span>Total</span><span>{money(total)}</span></div>
          {account && (
            <div className="rowline" style={{ marginTop: 4 }}>
              <span style={{ color: "var(--muted)" }}>You'll earn</span>
              <span style={{ color: "var(--leaf-ink)", fontWeight: 700 }}>+{Math.round(subtotal)} pts</span>
            </div>
          )}
        </div>

        {!account && (
          <button className="card" onClick={goJoin}
            style={{ padding: 14, marginTop: 12, width: "100%", display: "flex", gap: 11, alignItems: "center",
              textAlign: "left", border: "1px dashed var(--leaf)", cursor: "pointer", font: "inherit" }}>
            <Award size={20} color="var(--teal-ink)" style={{ flex: "0 0 auto" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Earn {Math.round(subtotal)} points on this order</div>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>Join free. Takes a few seconds.</div>
            </div>
            <ChevronRight size={17} color="var(--muted)" />
          </button>
        )}

        <Section title="Payment">
          {cloverStatus === "preview" ? (
            <div className="notice" role="status">
              <AlertCircle size={16} aria-hidden="true" style={{ flex: "0 0 auto" }} />
              <span>
                Online ordering isn't available right now.
                {cloverReason === "CREDENTIALS_REJECTED" && " The register isn't answering."}
              </span>
            </div>
          ) : (
            <div className="payatpickup">
              <Store size={20} aria-hidden="true" style={{ flex: "0 0 auto" }} />
              <div>
                <strong>PAY AT PICKUP</strong>
                <span className="pay-sub">
                  Nothing is charged now. Pay at the counter when you collect —
                  card or cash, whichever suits.
                </span>
              </div>
            </div>
          )}
        </Section>

        {payError && (
          <div className="pay-error" role="alert" style={{ marginTop: 14 }}>
            <strong>{payError.message}</strong>
            {payError.declineReason && (
              <div style={{ fontWeight: 400, marginTop: 3 }}>
                Reason: {String(payError.declineReason).replace(/_/g, " ")}
              </div>
            )}
            {payError.retryable && (
              <button className="pill-btn ghost" style={{ marginTop: 10 }}
                onClick={() => onPay(pickupChoice(), tip)}>
                Try again
              </button>
            )}
          </div>
        )}

        <button className="pill-btn" disabled={!ready || submitting || cloverStatus !== "online"}
          onClick={() => onPay(pickupChoice(), tip)}>
          {submitting ? "Sending to the kitchen…"
            : cloverStatus !== "online" ? "Ordering not available right now"
            : !open ? `Closed until ${formatTime(nextOpening(now))}`
            : !ready ? (!nameOk ? "Enter your name" : "Enter your phone number")
            : `Place order · ${money(total)} at pickup`}
        </button>
        <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 11, marginTop: 10 }}>
          {cloverStatus === "online"
            ? "Your order goes straight to the kitchen register."
            : "Preview mode · orders are not sent to the kitchen"}
        </div>
      </div>
    </>
  );
}
