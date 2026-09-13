import React, { useState } from "react";
import { Gift, Clock, Check } from "lucide-react";
import { CURRENCY_MANY } from "../lib/currency.js";
import { shareCode } from "../lib/share.js";

/* ============================================================================
   REFERRALS, FROM THE CUSTOMER'S SIDE

   Four things on one card, because they are four states of one thing and
   splitting them across the screen made each one look optional:

     - the code to hand out, and what it is worth
     - friends who have taken it but not ordered yet          (pendingOut)
     - 100 Petals waiting on the customer's own first order   (pendingIn)
     - a field to enter a code they forgot at signup, while the window is open

   WHY THE PENDING LINES EXIST. The credit fires on the friend's first PAID
   order, which can be days after they sign up. Without these, both sides see
   nothing at all and then a balance that jumps for no stated reason — which
   reads as a bug to the customer and as a support call to the shop.

   The card renders from the LAST KNOWN status, not only from a successful
   read: a customer's own code does not change, and blanking it when the
   server is unreachable made the whole card vanish. The balance already had a
   notice for that state and this now matches it.
   ============================================================================ */

/** Why a code was refused, in words a customer can act on. */
const REJECTION = {
  UNKNOWN_CODE: "We don't recognise that code. Check it with your friend.",
  OWN_CODE: "That's your own code — give it to a friend instead.",
  ALREADY_REFERRED: "There's already a friend's code on your account.",
  WINDOW_CLOSED: "Codes can only be added before your first order.",
  EMPTY: "Enter the code your friend gave you.",
};

export default function ReferralCard({
  referral, available = true, onEnterCode, perReferral = 100, perYear = 5,
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [shared, setShared] = useState(null);   // null | "shared" | "copied"

  if (!referral) return null;
  const { code: mine, referred, canBeReferred, pendingIn, pendingOut } = referral;

  const submit = async (e) => {
    e.preventDefault();
    if (busy || code.length < 6) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await onEnterCode(code);
      setResult(r.referralAccepted
        ? { ok: true, message: `Code accepted. You'll both get ${perReferral} ${CURRENCY_MANY} when you pay for your first order.` }
        : { ok: false, message: REJECTION[r.referralRejected] ?? "That code didn't work." });
      if (r.referralAccepted) setCode("");
    } catch (err) {
      setResult({ ok: false, message: err?.message || "Couldn't check that code just now." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ padding: 16, marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <Gift size={16} color="var(--leaf-ink)" aria-hidden="true" />
        <h3 style={{ fontWeight: 700, fontSize: 15, margin: 0 }}>Bring a friend</h3>
      </div>

      {mine ? (
        <>
          <p style={{ color: "var(--muted)", fontSize: 12.5, margin: "0 0 12px", lineHeight: 1.5 }}>
            Give them your code. When they pay for their first order you both get{" "}
            {perReferral} {CURRENCY_MANY}. Up to {perYear} friends a year.
          </p>
          <button
            onClick={() => shareCode(mine).then((how) => {
              setShared(how);
              setTimeout(() => setShared(null), 1800);
            })}
            aria-label={`Copy your referral code, ${mine.split("").join(" ")}`}
            style={{ width: "100%", padding: "14px 16px", borderRadius: 14, cursor: "pointer",
              border: "1px dashed var(--leaf-ink)", background: "var(--leaf-lt)",
              color: "var(--leaf-ink)", fontFamily: "ui-monospace, monospace",
              fontSize: 22, fontWeight: 700, letterSpacing: "0.18em" }}>
            {mine}
          </button>
          <div style={{ color: "var(--muted)", fontSize: 11.5, marginTop: 8, textAlign: "center" }}>
            {shared === "copied" ? "Copied" : shared === "shared" ? "Shared" : "Tap to copy"}
          </div>
        </>
      ) : (
        /* No code yet: the account predates codes and has not been re-read, or
           the server has never been reachable for it. Say which rather than
           showing an empty tile somebody would try to read out. */
        <p style={{ color: "var(--muted)", fontSize: 12.5, margin: 0, lineHeight: 1.5 }}>
          {available
            ? `Your code is on its way — open this screen again in a moment.`
            : `We can't reach the kitchen right now, so your code isn't loaded. It'll be here when you're back online.`}
        </p>
      )}

      {/* ---- pending, on the referrer's side ---- */}
      {pendingOut > 0 && (
        <div role="status" style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "flex-start",
          padding: "10px 12px", borderRadius: 11, background: "var(--pink-lt)" }}>
          <Clock size={14} aria-hidden="true" style={{ marginTop: 2, flex: "0 0 auto" }} />
          <span style={{ fontSize: 12.5, lineHeight: 1.45 }}>
            {pendingOut === 1
              ? `1 friend has your code and hasn't ordered yet.`
              : `${pendingOut} friends have your code and haven't ordered yet.`}
            {" "}Your {perReferral} {CURRENCY_MANY} land when they pay.
          </span>
        </div>
      )}

      {/* ---- pending, on the referred customer's own side ---- */}
      {pendingIn && (
        <div role="status" style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "flex-start",
          padding: "10px 12px", borderRadius: 11, background: "var(--pink-lt)" }}>
          <Clock size={14} aria-hidden="true" style={{ marginTop: 2, flex: "0 0 auto" }} />
          <span style={{ fontSize: 12.5, lineHeight: 1.45 }}>
            A friend's code is on your account. You both get {perReferral}{" "}
            {CURRENCY_MANY} once you've paid for your first order.
          </span>
        </div>
      )}

      {referred && !pendingIn && (
        <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center",
          color: "var(--leaf-ink)", fontSize: 12.5 }}>
          <Check size={14} aria-hidden="true" />
          <span>Your friend's code paid out. Thanks for coming in.</span>
        </div>
      )}

      {/* ---- entering a code they forgot at signup ----
          Open until their first paid order, which is when the window genuinely
          closes. Someone who signed up in a hurry used to lose it for good. */}
      {canBeReferred && onEnterCode && (
        <form onSubmit={submit} style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
          <label htmlFor="late-referral" style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>
            Got a code from a friend?
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <input id="late-referral" value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 6));
                setResult(null);
              }}
              placeholder="6 characters" autoCapitalize="characters" autoCorrect="off"
              spellCheck={false} disabled={busy}
              style={{ flex: 1, minWidth: 0, padding: "11px 12px", borderRadius: 11,
                border: "1px solid var(--line)", fontSize: 16,
                fontFamily: "ui-monospace, monospace", letterSpacing: "0.08em" }} />
            <button type="submit" className="pill-btn" disabled={busy || code.length < 6}
              style={{ width: "auto", padding: "0 18px", flex: "0 0 auto",
                opacity: (busy || code.length < 6) ? 0.5 : 1 }}>
              {busy ? "Checking…" : "Add"}
            </button>
          </div>
          <div style={{ color: "var(--muted)", fontSize: 11.5, marginTop: 8, lineHeight: 1.45 }}>
            You can add one until your first order.
          </div>
          {result && (
            <div role="status" style={{ marginTop: 10, padding: "10px 12px", borderRadius: 11,
              fontSize: 13, lineHeight: 1.45,
              background: result.ok ? "var(--leaf-lt)" : "var(--pink-lt)",
              color: result.ok ? "var(--leaf-ink)" : "var(--orchid-ink)" }}>
              {result.message}
            </div>
          )}
        </form>
      )}
    </div>
  );
}
