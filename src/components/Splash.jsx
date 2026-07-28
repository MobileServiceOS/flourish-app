/* Launch screen — flowers blooming open.

   Pure SVG and CSS keyframes. No animation library, no canvas: the whole thing
   is a handful of paths whose transform-origin sits at the centre of the
   flower, so scaling one from 0 to 1 unfurls it outward from the middle.

   Timeline:
     0.0 - 1.0s   main bloom, petals staggered 0.05s apart
     0.8 - 1.5s   two smaller blooms offset for depth
     1.0 - 1.8s   wordmark fades up out of the bloom's centre
     1.5 - 2.0s   hummingbird sweeps in from the right
     2.0 - 2.5s   everything fades, revealing the app

   The exit is a class rather than a keyframe on a timer. If the account is
   still loading at 2.0s the bloom simply holds, instead of fading to an empty
   screen and sitting there.

   prefers-reduced-motion drops all of it and shows the wordmark still. */
import React from "react";
import { Hummingbird } from "./shared.jsx";

const PETAL = "M60 60 C 50 44, 51.5 26, 60 15.5 C 68.5 26, 70 44, 60 60 Z";

/** One flower. `id` keeps each gradient unique in the document. */
function Bloom({ id, size, petals = 8, delay = 0, className = "", style }) {
  return (
    <svg className={`bloom ${className}`} width={size} height={size} viewBox="0 0 120 120"
      style={style} aria-hidden="true" focusable="false">
      <defs>
        {/* userSpaceOnUse so the sweep runs across the whole flower rather than
            restarting inside every petal's own box. */}
        <linearGradient id={`petal-${id}`} x1="8" y1="8" x2="112" y2="112" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#8E5BC4" />
          <stop offset="52%" stopColor="#E89AC7" />
          <stop offset="100%" stopColor="#AED86A" />
        </linearGradient>
        <radialGradient id={`core-${id}`}>
          <stop offset="0%" stopColor="#FFE9A3" />
          <stop offset="100%" stopColor="#FFD700" />
        </radialGradient>
      </defs>

      {Array.from({ length: petals }, (_, i) => (
        <path key={i} className="petal" d={PETAL} fill={`url(#petal-${id})`}
          style={{
            // the petal's own place in the circle, held in a variable so the
            // keyframe can rotate *from* slightly inside it
            "--a": `${(360 / petals) * i}deg`,
            // rounded, or float noise puts "0.35000000000000003s" in the DOM
            animationDelay: `${Math.round((delay + i * 0.05) * 100) / 100}s`,
          }} />
      ))}

      <circle className="bloom-core" cx="60" cy="60" r="8.5" fill={`url(#core-${id})`}
        style={{ animationDelay: `${delay + 0.32}s` }} />
    </svg>
  );
}

/* Pollen. Fixed offsets rather than random so every launch looks the same and
   the frames are reproducible. */
const POLLEN = [
  { x: -46, d: 0.55, t: 2.4, s: 3 }, { x: -22, d: 0.80, t: 2.9, s: 2 },
  { x: -6,  d: 0.65, t: 2.6, s: 2.5 }, { x: 14, d: 0.95, t: 3.1, s: 2 },
  { x: 30,  d: 0.72, t: 2.7, s: 3 },  { x: 52, d: 1.05, t: 2.5, s: 2 },
];

export default function Splash({ leaving = false, reduced = false }) {
  return (
    <div className={`splash${leaving ? " splash--out" : ""}${reduced ? " splash--still" : ""}`}
      role="status" aria-live="polite" aria-label="Loading Flourish">

      <div className="splash-stage">
        {!reduced && (
          <>
            <Bloom id="a" size={112} petals={7} delay={0.82} className="bloom--tl" />
            <Bloom id="b" size={92} petals={7} delay={1.02} className="bloom--br" />

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

        {!reduced && <Bloom id="main" size={220} petals={8} className="bloom--main" />}

        <div className="splash-word">
          <div className="splash-mark wordmark">Flourish</div>
          <div className="splash-sub">Bronx, NY</div>
        </div>

        {/* Two birds converging on the bloom, mirrored — the logo's composition,
            where a pair face each other across the flowers. */}
        {!reduced && (
          <>
            <div className="splash-bird splash-bird--l" aria-hidden="true">
              <Hummingbird size={54} />
            </div>
            <div className="splash-bird splash-bird--r" aria-hidden="true">
              <Hummingbird size={54} flip />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
