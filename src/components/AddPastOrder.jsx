import React, { useState } from "react";
import { Receipt, Check } from "lucide-react";
import { CURRENCY_MANY, currencyAmount } from "../lib/currency.js";

/* ============================================================================
   ADD A PAST ORDER

   A customer who walks in and orders at the counter has no way to earn
   otherwise. The receipt prints the Clover order id, so they type the tail of
   it and the server does the rest.

   NOTHING IS DECIDED HERE. Whether the order exists, whether it was paid,
   whether it is recent enough, whether those characters identify exactly one
   order, whether it has already been claimed, whether this phone has claimed
   too many today — every one of those is the server's answer. This component
   sends what was typed and renders what comes back. A client-side check would
   only ever be a courtesy, and writing one invites the belief that it is a
   control.

   The one thing it does locally is stop an obviously-too-short entry from
   becoming a request, because "enter a few more characters" is a better
   response than a round trip to be told the same.
   ============================================================================ */

/** Matches the server's floor. Fewer characters cannot identify one order. */
const MIN_CHARS = 4;

/* Clover's alphabet is Crockford base32 and omits I, L, O and U, so those four
   are safe to accept and let the server fold back. Everything else that is not
   a letter or digit is stripped as it is typed — receipts get read aloud and
   people add spaces and dashes. */
const tidy = (v) => String(v).toUpperCase().replace(/[^0-9A-Z]/g, "").slice(-13);

export default function AddPastOrder({ onClaim, disabled = false }) {
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);   // { ok, message, credited }

  const tooShort = ref.length < MIN_CHARS;

  const submit = async (e) => {
    e.preventDefault();
    if (busy || tooShort || disabled) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await onClaim(ref);
      setResult({
        ok: true,
        credited: r.credited,
        message: `${currencyAmount(r.credited)} added for your $${Number(r.net).toFixed(2)} order.`,
      });
      setRef("");
    } catch (err) {
      /* The server's message is written for the customer standing there with a
         receipt — "that order has already been added to an account" — so it is
         shown as-is rather than mapped to something vaguer. */
      setResult({ ok: false, message: err?.message || "That didn't work. Try again in a moment." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card" style={{ padding: 16, marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <Receipt size={16} color="var(--teal-ink)" aria-hidden="true" />
        <h3 style={{ fontWeight: 700, fontSize: 15, margin: 0 }}>Ordered at the counter?</h3>
      </div>
      <p style={{ color: "var(--muted)", fontSize: 12.5, margin: "0 0 12px", lineHeight: 1.5 }}>
        Add it and earn {CURRENCY_MANY} for it. Your receipt prints a{" "}
        <strong>Clover ID</strong> near the bottom — type the last few
        characters of it. Orders from the last 7 days.
      </p>

      {/* "Clover ID", NOT "order number". This app already calls FL-3412 the
          order number — OrderDetail labels it exactly that — so asking for the
          "order number from your receipt" sent customers looking for an FL
          number that is not printed on a counter receipt, and the claim then
          failed with "we couldn't find that order". The receipt says
          "Clover ID"; so does this. */}
      <label htmlFor="past-order-ref" style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>
        Clover ID from your receipt
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          id="past-order-ref"
          value={ref}
          onChange={(e) => { setRef(tidy(e.target.value)); setResult(null); }}
          placeholder="last 6, e.g. 4E3KNE"
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          disabled={disabled || busy}
          aria-describedby="past-order-help"
          style={{
            flex: 1, minWidth: 0, padding: "11px 12px", borderRadius: 11,
            border: "1px solid var(--line)", fontSize: 16,
            fontFamily: "ui-monospace, monospace", letterSpacing: "0.08em",
          }}
        />
        <button type="submit" className="pill-btn" disabled={disabled || busy || tooShort}
          style={{ width: "auto", padding: "0 18px", flex: "0 0 auto",
                   opacity: (disabled || busy || tooShort) ? 0.5 : 1 }}>
          {busy ? "Checking…" : "Add"}
        </button>
      </div>

      <p id="past-order-help" style={{ color: "var(--muted)", fontSize: 11.5, margin: "8px 0 0", lineHeight: 1.45 }}>
        {/* Deliberately NOT a second copy of the "balance unavailable" notice
            above this card. The customer has already read that sentence; what
            they need here is what it means for THIS form. */}
        {disabled
          ? `Past orders can be added once your balance is reachable again.`
          : `At least ${MIN_CHARS} characters. ${CURRENCY_MANY} land once the register
             confirms the order was paid.`}
      </p>

      {result && (
        <div role="status" style={{
          marginTop: 10, padding: "10px 12px", borderRadius: 11, fontSize: 13, lineHeight: 1.45,
          background: result.ok ? "var(--leaf-lt)" : "var(--pink-lt)",
          color: result.ok ? "var(--leaf-ink)" : "var(--orchid-ink)",
        }}>
          {result.ok && <Check size={14} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 6 }} />}
          {result.message}
        </div>
      )}
    </form>
  );
}
