import React, { useState } from "react";
import { Gift, Award } from "lucide-react";
import { REWARDS } from "../lib/loyalty.js";
import { formatPhone, phoneDigits, isValidPhone, isValidName } from "../lib/phone.js";
import { Hummingbird, SubHeader, Section } from "./shared.jsx";

/* ---------- REWARDS ---------- */
export default function SignInView({ onSignIn }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  // Only complain about a field the customer has actually left.
  const [touched, setTouched] = useState({});
  const clean = phoneDigits(phone);
  const nameOk = isValidName(name);
  const phoneOk = isValidPhone(phone);
  const ok = nameOk && phoneOk;
  return (
    <>
      <SubHeader title="Sign in" />
      <div style={{ padding: "4px 16px 24px" }}>
        <div className="reward-card" style={{ textAlign: "center" }}>
          <Hummingbird style={{ top: -6, right: -6, opacity: .35 }} size={70} flip />
          <Award size={30} style={{ marginBottom: 6 }} />
          <div className="serif" style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}>Join Flourish Rewards</div>
          <div style={{ fontSize: 13, opacity: .95, marginTop: 6, lineHeight: 1.45 }}>
            Earn a point for every dollar. Free sides, free drinks, free plates.
          </div>
        </div>

        <Section title="Your details">
          <input className="field" placeholder="Full name" aria-label="Full name" autoComplete="name"
            value={name} onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, name: true }))}
            aria-invalid={touched.name && !nameOk ? "true" : undefined}
            aria-describedby="name-hint" />
          <div id="name-hint" className={`field-hint${touched.name && !nameOk ? " bad" : ""}`}>
            {touched.name && !nameOk ? "Please enter at least 2 characters." : "So we know whose order to call out."}
          </div>

          <input className="field" placeholder="(347) 859-9413" aria-label="Phone number"
            inputMode="tel" autoComplete="tel" type="tel" value={phone}
            style={{ marginTop: 12 }}
            onChange={(e) => setPhone(formatPhone(e.target.value))}
            onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
            aria-invalid={touched.phone && !phoneOk ? "true" : undefined}
            aria-describedby="phone-hint" />
          <div id="phone-hint" className={`field-hint${touched.phone && !phoneOk ? " bad" : ""}`}>
            {touched.phone && !phoneOk
              ? `A 10-digit US number — ${clean.length} of 10 so far.`
              : "10 digits, US number."}
          </div>
        </Section>
        <div style={{ color: "var(--muted)", fontSize: 11.5, margin: "10px 2px 0", lineHeight: 1.45 }}>
          We use your number to look up your points and text you when your order is ready. Nothing else.
        </div>

        <button className="pill-btn" style={{ marginTop: 16 }} disabled={!ok}
          onClick={() => onSignIn(name.trim(), clean)}>
          {ok ? "Create my account" : !nameOk ? "Enter your name" : "Enter your phone number"}
        </button>

        <h3 className="serif" style={{ fontWeight: 700, fontSize: 18, margin: "26px 4px 10px" }}>What you unlock</h3>
        {REWARDS.map((r) => (
          <div key={r.id} className="card" style={{ padding: 14, marginBottom: 10, display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, flex: "0 0 auto",
              background: "linear-gradient(135deg,var(--leaf-lt),var(--teal))", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Gift size={19} color="#fff" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>{r.name}</div>
              <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{r.cost} pts · {r.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
