import React, { useState, useEffect } from "react";
import { MapPin, Check, Clock, Award, ChevronRight, Store, AlertCircle, Car } from "lucide-react";
import { cents, money, taxOn, TAX_LABEL } from "../lib/money.js";
import {
  isOpen, nextOpening, formatTime, describeOpening, closingOn, HOURS_LINE,
} from "../lib/hours.js";
import { PREP_RANGE_LABEL } from "../lib/prep.js";
import { formatPhone, phoneDigits, isValidPhone, isValidName } from "../lib/phone.js";
import { SubHeader, Section } from "./shared.jsx";

/* ---------- CHECKOUT ---------- */
export default function CheckoutView({
  subtotal, points, account, goJoin, discount = 0, appliedVoucher, onBack, onPay,
  cloverStatus = "preview", cloverReason = null, submitting = false, payError = null, onClearError,
  /* When the food will be ready, worked out by the server from what is in the
     cart. Null until it answers — the screen says it is checking rather than
     guessing a number, because a guess here is a promise the kitchen never
     made. There is no ASAP any more: a salmon plate and a jerk chicken do not
     take the same time and quoting one figure for both is how a customer
     arrives to a wait. */
  quote = null,
}) {
  /* Pay at pickup, always. The app takes no money — the order goes to the
     register unpaid and the customer settles at the counter. */
  const [name, setName] = useState(account ? account.name : "");
  // The account stores bare digits; show them the way they typed them.
  const [phone, setPhone] = useState(account ? formatPhone(account.phone) : "");
  const [touched, setTouched] = useState({});

  /* Curbside. People double-park on Laconia and get ticketed, so "I'll wait in
     my car" is the reason a lot of them will use the app at all. Off by
     default: most collect at the counter, and a toggle that starts on would put
     CURBSIDE on every ticket. */
  const [curbside, setCurbside] = useState(false);
  const [vehicle, setVehicle] = useState("");
  const [plate, setPlate] = useState("");
  /* A toggle with no description is a ticket telling staff to walk food out to a
     car they cannot identify, so the description is required once it is on. */
  const vehicleOk = !curbside || vehicle.trim().length >= 3;
  const [tipIdx, setTipIdx] = useState(1);
  const tips = [0, 0.1, 0.15, 0.2];
  const base = Math.max(0, subtotal - discount);
  const tip = cents(subtotal * tips[tipIdx]);   // tip on pre-discount value
  const tax = taxOn(base);
  const total = cents(base + tax + tip);

  /* The clock still ticks here, but only to keep the closed/open messaging and
     the "closes at" line honest. Times themselves come from the server. */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const open = isOpen(now);
  // Bookable times are the server's too, for the same reason the window is.
  const slots = quote?.slots ?? [];
  const [slotIso, setSlotIso] = useState("");   // "" = the next available window
  // A slot that has drifted out of the server's list has passed; drop back to
  // the window rather than selling a time that is gone.
  useEffect(() => {
    if (slotIso && !slots.some((s) => s.iso === slotIso)) setSlotIso("");
  }, [slots, slotIso]);

  /* What gets sent. `iso` is set only for a scheduled slot; without it the
     server uses the window it just quoted. The label is never invented here. */
  const pickupChoice = () => {
    const slot = slots.find((s) => s.iso === slotIso);
    return slot
      ? { label: slot.label, iso: slot.iso }
      : { label: quote?.label ?? "", iso: null };
  };

  /* Sent with the order. The phone goes as bare digits — the ticket formats it
     — and this is what puts the customer's name on the printed ticket at all. */
  const contact = () => ({ name: name.trim(), phone: phoneDigits(phone) });

  /* Sent only when the toggle is on, so the server and the ticket never carry a
     stale description from a toggle someone switched off again. */
  const curbsideChoice = () => (curbside
    ? { waiting: true, vehicle: vehicle.trim(), plate: plate.trim() }
    : null);

  const nameOk = isValidName(name);
  const phoneOk = isValidPhone(phone);
  // No quote means we do not yet know the food can be cooked before close, and
  // `fitsBeforeClose: false` means it cannot.
  const canCook = Boolean(quote?.fitsBeforeClose);
  const ready = nameOk && phoneOk && vehicleOk && open && canCook && subtotal > 0;

  return (
    <>
      <SubHeader title="Checkout" onBack={onBack} />
      <div style={{ padding: "4px 16px 24px" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "12px 14px", borderRadius: 14,
          background: "rgba(47,182,168,.10)", marginTop: 4 }}>
          <MapPin size={17} color="var(--teal-ink)" style={{ flex: "0 0 auto", marginTop: 1 }} />
          <div style={{ fontSize: 13, lineHeight: 1.4 }}>
            <strong>Pickup only · ready in {PREP_RANGE_LABEL}</strong><br />
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
              {/* The window the kitchen quoted for THIS cart. Not a constant,
                  and not computed here — cooked-to-order items push it out. */}
              <button className={`slot-window ${slotIso === "" ? "on" : ""}`} onClick={() => setSlotIso("")}
                aria-pressed={slotIso === ""} disabled={!quote}>
                <Clock size={17} aria-hidden="true" />
                <span>
                  <strong>
                    {quote ? `Ready ${quote.label}` : "Checking with the kitchen…"}
                  </strong>
                  <span style={{ display: "block", fontSize: 12, opacity: .85 }}>
                    {quote
                      ? `About ${quote.prepMinutes} minutes from now`
                      : "Working out how long your order needs"}
                  </span>
                </span>
                {slotIso === "" && quote && <Check size={17} style={{ marginLeft: "auto" }} aria-hidden="true" />}
              </button>

              {!canCook && quote && (
                <div className="closed-card" role="status" style={{ marginTop: 12 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
                    Not enough time to cook this today
                  </div>
                  <div style={{ fontSize: 13.5, lineHeight: 1.45 }}>
                    Your order needs {quote.prepMinutes} minutes and the kitchen closes at{" "}
                    {formatTime(closingOn(now))}. Remove the cooked-to-order items, or
                    order again tomorrow — your cart is kept.
                  </div>
                </div>
              )}

              <label htmlFor="slot" className="slot-label">Or schedule it</label>
              <select id="slot" className="field" value={slotIso}
                onChange={(e) => setSlotIso(e.target.value)}>
                <option value="">{quote ? `Ready ${quote.label}` : "Next available"}</option>
                {slots.map((s) => (
                  <option key={s.iso} value={s.iso}>{s.label}</option>
                ))}
              </select>
              <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
                {slots.length
                  ? `${slots.length} pickup time${slots.length > 1 ? "s" : ""} left today · kitchen closes at ${formatTime(closingOn(now))}`
                  : `No later times left today · kitchen closes at ${formatTime(closingOn(now))}`}
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

        <Section title="Collecting it">
          <button className={`slot-window ${curbside ? "on" : ""}`}
            onClick={() => setCurbside((v) => !v)} aria-pressed={curbside}>
            <Car size={17} aria-hidden="true" />
            <span>
              <strong>I'll wait in my car</strong>
              <span style={{ display: "block", fontSize: 12, opacity: .85 }}>
                Staff bring it out — no need to park up
              </span>
            </span>
            {curbside && <Check size={17} style={{ marginLeft: "auto" }} aria-hidden="true" />}
          </button>

          {curbside && (
            <>
              <input className="field" style={{ marginTop: 12 }}
                placeholder="Blue Honda Civic" aria-label="Vehicle description"
                autoComplete="off" maxLength={60}
                value={vehicle} onChange={(e) => setVehicle(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, vehicle: true }))}
                aria-invalid={touched.vehicle && !vehicleOk ? "true" : undefined}
                aria-describedby="co-vehicle-hint" />
              <div id="co-vehicle-hint" className={`field-hint${touched.vehicle && !vehicleOk ? " bad" : ""}`}>
                {touched.vehicle && !vehicleOk
                  ? "Make and colour, so staff can spot you."
                  : "Make and colour — staff look for this, not your name."}
              </div>
              <input className="field" style={{ marginTop: 8 }}
                placeholder="Plate (optional)" aria-label="Licence plate, optional"
                autoComplete="off" maxLength={12}
                value={plate} onChange={(e) => setPlate(e.target.value)} />
            </>
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
              <span style={{ color: "var(--muted)" }}>You'll earn when you pay</span>
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
                onClick={() => onPay(pickupChoice(), tip, contact(), curbsideChoice())}>
                Try again
              </button>
            )}
          </div>
        )}

        <button className="pill-btn" disabled={!ready || submitting || cloverStatus !== "online"}
          onClick={() => onPay(pickupChoice(), tip, contact(), curbsideChoice())}>
          {submitting ? "Sending to the kitchen…"
            : cloverStatus !== "online" ? "Ordering not available right now"
            : !open ? `Closed until ${formatTime(nextOpening(now))}`
            : !nameOk ? "Enter your name"
            : !phoneOk ? "Enter your phone number"
            : !vehicleOk ? "Describe your car"
            : !quote ? "Checking with the kitchen…"
            : !canCook ? "Not enough time to cook this today"
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
