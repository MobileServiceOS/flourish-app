/* Pieces used by more than one screen. */
import React, { useState, useEffect, useRef } from "react";
import { Check, ChevronLeft } from "lucide-react";

export function Hummingbird({ style, size = 44, flip }) {
  return (
    <svg className="floral" style={style} width={size} height={size} viewBox="0 0 64 64"
      fill="none" transform={flip ? "scale(-1,1)" : ""}>
      <path d="M30 34c-6 2-14 3-22 1 6 5 14 6 20 4z" fill="var(--teal)"/>
      <path d="M34 30c4-6 6-14 5-22-5 6-7 14-6 20z" fill="var(--orchid-lt)"/>
      <ellipse cx="33" cy="34" rx="8" ry="5" fill="var(--pink)"/>
      <path d="M40 33l10-3-9 6z" fill="var(--orchid)"/>
      <circle cx="30" cy="32" r="2" fill="var(--orchid)"/>
    </svg>
  );
}

export function Thumb({ item }) {
  const [err, setErr] = useState(false);
  if (item.img && !err) {
    return (
      <img className="thumb" src={item.img} alt={item.name} loading="lazy" decoding="async"
        width={82} height={82} onError={() => setErr(true)} />
    );
  }
  return <div className="thumb" role="img" aria-label={item.name}>{item.emoji || "🍽️"}</div>;
}

/* Modal plumbing shared by the item sheet and the staff sheet: Escape closes,
   focus moves into the sheet on open and back to where it was on close, and
   Tab is kept inside while it's up. */
export function useSheet(onClose) {
  const ref = useRef(null);
  useEffect(() => {
    const opener = document.activeElement;
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab") return;
      const f = ref.current?.querySelectorAll(
        'button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!f?.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    // Don't steal focus onto the close button — put it on the sheet itself.
    ref.current?.focus?.({ preventScroll: true });
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (opener instanceof HTMLElement) opener.focus?.({ preventScroll: true });
    };
  }, [onClose]);
  return ref;
}

export function SubHeader({ title, onBack }) {
  return (
    <header className="hdr" style={{ paddingBottom: 18 }}>
      <Hummingbird style={{ top: 4, right: -6 }} size={46} flip />
      {onBack && (
        <button onClick={onBack} style={{ background: "none", border: 0, color: "var(--orchid-ink)", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 3, marginBottom: 6, padding: 0 }}>
          <ChevronLeft size={18} /> Back
        </button>
      )}
      <h1 className="serif" style={{ fontWeight: 700, fontSize: 27, margin: 0 }}>{title}</h1>
    </header>
  );
}
/* Labelled block inside the item sheet (a Clover modifier group). */
export const Group = ({ label, children }) => (
  <div style={{ marginBottom: 18 }}>
    <div style={{ fontWeight: 700, fontSize: 13.5, letterSpacing: .2, margin: "0 2px 9px", color: "var(--ink)" }}>
      {label}
    </div>
    {children}
  </div>
);

/* One selectable modifier. `right` shows its price or "Included". */
export const Option = ({ sel, onClick, label, right }) => (
  <div className={"opt" + (sel ? " sel" : "")} onClick={onClick} role="button" tabIndex={0}
    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}>
    <span style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
      <span className="radio">{sel && <Check size={12} color="#fff" strokeWidth={3} />}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
    </span>
    {right && <span style={{ color: "var(--muted)", fontSize: 13, flex: "0 0 auto", marginLeft: 10 }}>{right}</span>}
  </div>
);

export const Section = ({ title, children }) => (
  <div style={{ marginTop: 18 }}>
    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>{title}</div>
    {children}
  </div>
);
export function Empty({ icon, title, text, cta, onCta }) {
  return (
    <div style={{ textAlign: "center", padding: "60px 30px" }}>
      <div style={{ width: 68, height: 68, borderRadius: 20, margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center",
        background: "linear-gradient(135deg,var(--pink-lt),var(--leaf-lt))", color: "#fff" }}>{icon}</div>
      <div className="serif" style={{ fontWeight: 700, fontSize: 20 }}>{title}</div>
      <div style={{ color: "var(--muted)", fontSize: 14, marginTop: 6 }}>{text}</div>
      {cta && <button className="pill-btn" style={{ marginTop: 20, maxWidth: 220 }} onClick={onCta}>{cta}</button>}
    </div>
  );
}
