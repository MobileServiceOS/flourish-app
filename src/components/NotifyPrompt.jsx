/* "Tell me when it's ready" on the confirmation screen.

   Deliberately asked here rather than at launch: the customer is standing there
   waiting for food, so the reason for the OS prompt is obvious and it actually
   gets accepted. A cold prompt on first open mostly gets denied, and iOS only
   lets you ask once.

   Every state says something true. If they decline, we do not nag — we point at
   the live status on this same screen, which always works. */
import React, { useEffect, useState } from "react";
import { Bell, BellOff, Check } from "lucide-react";
import { permissionState, requestPermission, scheduleOrderReady } from "../lib/notify.js";

export default function NotifyPrompt({ orderNum, readyAt, itemCount }) {
  const [state, setState] = useState("loading");   // loading|prompt|granted|denied|unsupported
  const [scheduled, setScheduled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    permissionState().then(async (s) => {
      if (!alive) return;
      setState(s);
      // Already allowed from a previous order — just book this one silently.
      if (s === "granted") {
        const ok = await scheduleOrderReady({ orderNum, at: readyAt, itemCount });
        if (alive) setScheduled(ok);
      }
    });
    return () => { alive = false; };
  }, [orderNum, readyAt, itemCount]);

  const ask = async () => {
    setBusy(true);
    const s = await requestPermission();
    setState(s);
    if (s === "granted") {
      setScheduled(await scheduleOrderReady({ orderNum, at: readyAt, itemCount }));
    }
    setBusy(false);
  };

  if (state === "loading" || state === "unsupported") return null;

  if (state === "granted") {
    return (
      <div className="notify-row on" role="status">
        <Check size={17} aria-hidden="true" />
        <span>
          {scheduled
            ? "We'll notify you when it's ready."
            : "Notifications are on. Watch the status above for this one."}
        </span>
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="notify-row" role="status">
        <BellOff size={17} aria-hidden="true" />
        <span>
          Notifications are off, so keep an eye on the status above — or turn them
          on in your phone's settings for next time.
        </span>
      </div>
    );
  }

  return (
    <button className="notify-cta" onClick={ask} disabled={busy}>
      <Bell size={18} aria-hidden="true" />
      <span>
        <strong>{busy ? "Just a moment…" : "Tell me when it's ready"}</strong>
        <span className="notify-sub">
          One notification, when your food is up. Nothing else, ever.
        </span>
      </span>
    </button>
  );
}
