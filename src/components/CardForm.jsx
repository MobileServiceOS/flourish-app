/* Clover hosted card fields.

   The card number never touches our JavaScript — Clover mounts cross-origin
   iframes and hands back a single-use token. That token goes to our proxy,
   which charges it with the private key. This component only ever sees the
   token and any validation errors.

   `sdkLoader` is injectable so tests can drive it without the real script. */
import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { loadCloverSdk, PUBLIC_TOKEN } from "../lib/clover.js";

const FIELDS = [
  ["CARD_NUMBER", "card-number", "Card number"],
  ["CARD_DATE", "card-date", "Expiry"],
  ["CARD_CVV", "card-cvv", "CVC"],
  ["CARD_POSTAL_CODE", "card-postal", "ZIP"],
];

const STYLES = {
  body: { fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" },
  input: {
    fontSize: "15px", padding: "14px", color: "#3A2E45",
    border: "1px solid #EFE6F3", borderRadius: "14px", background: "#fff",
  },
  "input:focus": { borderColor: "#7A45B0", outline: "none" },
};

export const CardForm = forwardRef(function CardForm(
  { onReady, sdkLoader = loadCloverSdk }, ref
) {
  const [status, setStatus] = useState("loading");   // loading | ready | failed
  const [fieldError, setFieldError] = useState(null);
  const cloverRef = useRef(null);
  const mounted = useRef(false);

  useEffect(() => {
    let alive = true;
    if (!PUBLIC_TOKEN) { setStatus("failed"); return; }

    sdkLoader()
      .then((Clover) => {
        if (!alive || mounted.current) return;
        mounted.current = true;
        const clover = new Clover(PUBLIC_TOKEN);
        cloverRef.current = clover;
        const elements = clover.elements();

        for (const [type, slot] of FIELDS) {
          const el = elements.create(type, STYLES);
          el.mount(`#clover-${slot}`);
          // Clover reports per-field validation as you type.
          el.addEventListener?.("change", (e) => {
            if (!alive) return;
            setFieldError(e?.error || null);
          });
        }
        setStatus("ready");
        onReady?.();
      })
      .catch((e) => { if (alive) { setStatus("failed"); setFieldError(e.message); } });

    return () => { alive = false; };
  }, [sdkLoader, onReady]);

  useImperativeHandle(ref, () => ({
    /** Resolves to a single-use token, or throws with a readable message. */
    async tokenize() {
      const clover = cloverRef.current;
      if (!clover) throw new Error("Card form isn't ready yet");
      const result = await clover.createToken();
      const err = result?.errors && Object.values(result.errors).filter(Boolean)[0];
      if (err) throw new Error(String(err));
      if (!result?.token) throw new Error("Couldn't read that card. Check the details and try again.");
      return result.token;
    },
    isReady: () => status === "ready",
  }), [status]);

  if (status === "failed") {
    return (
      <div className="pay-error" role="alert">
        {PUBLIC_TOKEN
          ? (fieldError || "The card form couldn't load.")
          : "Card payment isn't configured yet."}
        {" "}Choose <strong>Pay at pickup</strong> to place your order.
      </div>
    );
  }

  return (
    <div aria-busy={status === "loading"}>
      {status === "loading" && (
        <div className="field-hint" role="status">Loading secure card form…</div>
      )}
      <div className="card-grid" data-testid="card-fields">
        {FIELDS.map(([, slot, label]) => (
          <div key={slot} className={slot === "card-number" ? "card-cell wide" : "card-cell"}>
            <label className="card-label" htmlFor={`clover-${slot}`}>{label}</label>
            <div id={`clover-${slot}`} className="card-mount" />
          </div>
        ))}
      </div>
      {fieldError && <div className="pay-error" role="alert">{fieldError}</div>}
      <div className="field-hint">
        Card details go straight to Clover. This app never sees your card number.
      </div>
    </div>
  );
});

export default CardForm;
