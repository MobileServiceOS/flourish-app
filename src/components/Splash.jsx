/* Launch screen — the logo, with flowers blooming open around it.

   The petals are a ring, not a flower: they sit outside the logo's edge and
   unfurl outward, framing the artwork rather than competing with it. The logo
   already contains its own flowers, leaves and pair of hummingbirds, so nothing
   here duplicates them.

   Timeline:
     0.0 - 1.0s   the ring of petals unfurls, staggered 0.05s apart
     0.35 - 1.25s the logo fades up in the centre as they open
     0.8 - 1.5s   two smaller blooms offset for depth
     1.5 - 2.0s   pollen still drifting, everything settled
     2.0 - 2.5s   fades out, revealing the app

   Pure CSS keyframes and SVG. The exit is a class rather than a keyframe on a
   timer, so a slow account read holds the frame instead of fading to nothing. */
import React from "react";

/* A petal in the outer band: from r=26 to r=2 of a 120 viewBox, so the middle
   stays clear for the logo. transform-origin at the centre means scaling from 0
   unfurls it outward. */
const PETAL = "M60 26 C 51 19, 52.5 9, 60 2 C 67.5 9, 69 19, 60 26 Z";

function Ring({ id, size, petals = 8, delay = 0, className = "", style }) {
  return (
    <svg className={`bloom ${className}`} width={size} height={size} viewBox="0 0 120 120"
      style={style} aria-hidden="true" focusable="false">
      <defs>
        {/* userSpaceOnUse so the sweep runs across the whole ring rather than
            restarting inside every petal's own box. */}
        <linearGradient id={`petal-${id}`} x1="8" y1="8" x2="112" y2="112" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#8E5BC4" />
          <stop offset="52%" stopColor="#E89AC7" />
          <stop offset="100%" stopColor="#AED86A" />
        </linearGradient>
      </defs>
      {Array.from({ length: petals }, (_, i) => (
        <path key={i} className="petal" d={PETAL} fill={`url(#petal-${id})`}
          style={{
            "--a": `${(360 / petals) * i}deg`,
            // rounded, or float noise puts "0.35000000000000003s" in the DOM
            animationDelay: `${Math.round((delay + i * 0.05) * 100) / 100}s`,
          }} />
      ))}
    </svg>
  );
}

const POLLEN = [
  { x: -62, d: 0.55, t: 2.4, s: 3 }, { x: -34, d: 0.80, t: 2.9, s: 2 },
  { x: -12, d: 0.65, t: 2.6, s: 2.5 }, { x: 16, d: 0.95, t: 3.1, s: 2 },
  { x: 40,  d: 0.72, t: 2.7, s: 3 },  { x: 66, d: 1.05, t: 2.5, s: 2 },
];

export default function Splash({ leaving = false, reduced = false }) {
  return (
    <div className={`splash${leaving ? " splash--out" : ""}${reduced ? " splash--still" : ""}`}
      role="status" aria-live="polite" aria-label="Loading Flourish">

      <div className="splash-stage">
        {!reduced && (
          <>
            <Ring id="main" size={360} petals={8} className="bloom--main" />
            <Ring id="a" size={104} petals={7} delay={0.82} className="bloom--tl" />
            <Ring id="b" size={86} petals={7} delay={1.02} className="bloom--br" />

            <div className="pollen" aria-hidden="true">
              {POLLEN.map((p, i) => (
                <span key={i} style={{
                  left: `calc(50% + ${p.x}px)`,
                  width: p.s, height: p.s,
                  animationDelay: `${p.d}s`,
                  animationDuration: `${p.t}s`,
                }} />
              ))}
            </div>
          </>
        )}

        {/* The artwork itself. alt rather than aria-hidden so the launch screen
            still says what it is if the images fail to load. */}
        <img className="splash-logo" src="/logo-512.png" alt="Flourish"
          width={190} height={190} decoding="async" fetchPriority="high" />
      </div>

      <div className="splash-sub">Bronx, NY</div>
    </div>
  );
}
