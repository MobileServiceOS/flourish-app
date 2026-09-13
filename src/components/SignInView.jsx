import React, { useState } from "react";
import { Gift, Award, Receipt } from "lucide-react";
import {
  REWARDS, capLabel, CURRENCY_ONE, CURRENCY_MANY, SEPARATE_FROM_PERKS, ONE_REWARD_PER_ORDER,
} from "../lib/loyalty.js";
import { formatPhone, phoneDigits, isValidPhone, isValidName } from "../lib/phone.js";
import { Hummingbird, SubHeader, Section } from "./shared.jsx";

/* ---------- REWARDS ---------- */
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

/* February gets 29: the year is unknown, so a leap-day birthday has to be
   allowed. The server validates the same way. */
const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const daysInMonth = (month) => DAYS[Number(month) - 1] ?? 31;

/** `M-D`, or undefined when either half is missing. Never a year. */
function birthdayValue(v) {
  const [m, d] = String(v ?? "").split("-");
  if (!m || !d) return undefined;
  return `${m}-${d}`;
}

/* A refusal a customer can act on, rather than a silent shrug. The first
   version of this screen accepted anything and told them they were all set. */
const CODE_PROBLEM = {
  UNKNOWN_CODE: "We don't recognise that code. Check it with your friend.",
  OWN_CODE: "That's your own code — you can't refer yourself.",
  ALREADY_REFERRED: "There's already a friend's code on this number.",
  WINDOW_CLOSED: "Codes can only be added before your first order.",
  EMPTY: "Enter the code your friend gave you.",
};

export default function SignInView({ onSignIn, rewards = REWARDS, onCheckCode }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  /* Both optional, and both only mean anything the first time a number is seen.
     A required field costs signups, and neither of these is worth a customer
     abandoning the form over — so nothing below blocks the button. */
  const [birthday, setBirthday] = useState("");
  const [referralCode, setReferralCode] = useState("");
  /* null = not checked, or the server's verdict on the code as typed. Checked
     BEFORE the account is created, so a typo is fixable here rather than
     discovered never — once an account exists and has ordered, the window for
     applying a code has genuinely closed and nothing in the app can reopen
     it. */
  const [codeState, setCodeState] = useState(null);   // null | "checking" | {valid, reason}
  // Only complain about a field the customer has actually left.
  const [touched, setTouched] = useState({});
  const clean = phoneDigits(phone);
  const nameOk = isValidName(name);
  const phoneOk = isValidPhone(phone);
  const ok = nameOk && phoneOk;

  /* Checked on blur and again before submitting. It never BLOCKS the signup —
     an optional field must not stop someone joining — but a wrong code is
     reported before the account exists, which is the only moment it can still
     be corrected. */
  const checkCode = async () => {
    if (!referralCode || !onCheckCode) return null;
    setCodeState("checking");
    try {
      const r = await onCheckCode({ phone: clean, code: referralCode });
      setCodeState(r);
      return r;
    } catch {
      /* Unreachable server: say nothing rather than accuse the code. It is
         sent anyway and the claim will decide. */
      setCodeState(null);
      return null;
    }
  };
  return (
    <>
      <SubHeader title="Sign in" />
      <div style={{ padding: "4px 16px 24px" }}>
        <div className="reward-card" style={{ textAlign: "center" }}>
          <Hummingbird style={{ top: -6, right: -6, opacity: .35 }} size={70} flip />
          <Award size={30} style={{ marginBottom: 6 }} />
          <div className="serif" style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}>Join Flourish Rewards</div>
          <div style={{ fontSize: 13, opacity: .95, marginTop: 6, lineHeight: 1.45 }}>
            Earn a {CURRENCY_ONE} for every dollar. Free sides, free drinks, free plates.
          </div>
          {/* 50 {CURRENCY_MANY} FOR JOINING, SAID BEFORE THEY JOIN. It was
              being paid and never mentioned, which is a reason to sign up
              thrown away — and then 50 Petals landing unexplained. */}
          <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 999,
            background: "rgba(255,255,255,.22)", display: "inline-block",
            fontSize: 13, fontWeight: 700 }}>
            50 {CURRENCY_MANY} just for joining
          </div>
        </div>

        {/* THE CONVERSION MOMENT.

            A walk-in holding a receipt is who the claim feature is FOR, and
            they could not see it: "Add a past order" lives on the Rewards
            screen, which only renders once an account exists. So the one
            person the feature was built for met a signup form that never
            mentioned the receipt in their hand.

            It is stated here, before the form, because it is the strongest
            reason on this screen to bother signing up at all — money already
            spent, waiting to be claimed. */}
        <div className="card" style={{ padding: 14, margin: "14px 0 4px",
          display: "flex", gap: 10, alignItems: "flex-start" }}>
          <Receipt size={18} color="var(--teal-ink)" aria-hidden="true"
            style={{ marginTop: 1, flex: "0 0 auto" }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Ordered at the counter?</div>
            <div style={{ color: "var(--muted)", fontSize: 12.5, lineHeight: 1.45, marginTop: 3 }}>
              Your receipt is worth {CURRENCY_MANY}. Join, then add any order from
              the last 7 days using the Clover ID printed on it.
            </div>
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
          We use your number to look up your {CURRENCY_MANY} and to reach you about an order. Nothing else.
        </div>

        <Section title="Optional">
          {/* MONTH AND DAY ONLY — the year is discarded before anything is
              sent, and the server has no column for it. A birthday needs to
              know when to fire, not how old anyone is, and a date of birth is
              the field that turns a loyalty database into an identity-theft
              target. The input is a plain month/day pair rather than a date
              picker for exactly that reason: there is nowhere to type a year. */}
          <label htmlFor="birth-month" style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>
            Birthday — we'll send you a free plate
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <select id="birth-month" className="field" style={{ flex: 1, minWidth: 0 }}
              aria-label="Birth month"
              value={birthday.split("-")[0] ?? ""}
              onChange={(e) => setBirthday(`${e.target.value}-${birthday.split("-")[1] ?? ""}`)}>
              <option value="">Month</option>
              {MONTHS.map((m, i) => (
                <option key={m} value={String(i + 1)}>{m}</option>
              ))}
            </select>
            <select className="field" style={{ width: 104, flex: "0 0 auto" }}
              aria-label="Birth day"
              value={birthday.split("-")[1] ?? ""}
              onChange={(e) => setBirthday(`${birthday.split("-")[0] ?? ""}-${e.target.value}`)}>
              <option value="">Day</option>
              {Array.from({ length: daysInMonth(birthday.split("-")[0]) }, (_, i) => (
                <option key={i + 1} value={String(i + 1)}>{i + 1}</option>
              ))}
            </select>
          </div>
          <div className="field-hint">
            Month and day only — we never ask for the year.
          </div>

          <input className="field" style={{ marginTop: 12, textTransform: "uppercase",
                   fontFamily: "ui-monospace, monospace", letterSpacing: "0.08em" }}
            placeholder="Referral code" aria-label="Referral code from a friend"
            autoCapitalize="characters" autoCorrect="off" spellCheck={false}
            value={referralCode}
            onChange={(e) => {
              setReferralCode(
                e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 6));
              setCodeState(null);
            }}
            onBlur={checkCode}
            aria-invalid={codeState?.valid === false ? "true" : undefined}
            aria-describedby="referral-hint" />
          <div id="referral-hint"
            className={`field-hint${codeState?.valid === false ? " bad" : ""}`}>
            {codeState === "checking" ? "Checking that code…"
              : codeState?.valid === true ? `Code looks good — you'll both earn 100 ${CURRENCY_MANY}.`
              : codeState?.valid === false ? (CODE_PROBLEM[codeState.reason] ?? "That code didn't work.")
              : `Got a code from a friend? You both earn 100 ${CURRENCY_MANY} when you pay for your first order.`}
          </div>
        </Section>

        <button className="pill-btn" style={{ marginTop: 16 }} disabled={!ok}
          onClick={() => onSignIn(name.trim(), clean, {
            /* Only sent when BOTH halves are chosen. A half-filled date is not
               a date, and the server would refuse it — which would turn an
               optional field into a blocked signup. */
            birthday: birthdayValue(birthday),
            referralCode: referralCode || undefined,
          })}>
          {ok ? "Create my account" : !nameOk ? "Enter your name" : "Enter your phone number"}
        </button>

        <h3 className="serif" style={{ fontWeight: 700, fontSize: 18, margin: "26px 4px 10px" }}>What you unlock</h3>
        {rewards.map((r) => (
          <div key={r.id} className="card" style={{ padding: 14, marginBottom: 10, display: "flex", gap: 12, alignItems: "center" }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, flex: "0 0 auto",
              background: "linear-gradient(135deg,var(--leaf-lt),var(--teal))", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Gift size={19} color="#fff" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>{r.name}</div>
              <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{r.cost} {CURRENCY_MANY} · {capLabel(r)}</div>
            </div>
          </div>
        ))}

        {/* Said before they join, not after. Someone who already texts their
            receipt code for Perks needs to know this is a second, separate
            balance before they start expecting one total. */}
        <p style={{ color: "var(--muted)", fontSize: 11.5, lineHeight: 1.5, margin: "12px 4px 0" }}>
          {ONE_REWARD_PER_ORDER} {SEPARATE_FROM_PERKS}
        </p>
      </div>
    </>
  );
}
