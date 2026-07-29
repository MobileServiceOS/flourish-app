/* Launch screen — the logo, with watercolour blooms opening around it.

   The petals are a ring, not a flower: they sit outside the artwork and unfurl
   outward, framing it. The logo already contains its own flowers, leaves and
   pair of hummingbirds, so nothing here duplicates them — the blooms just carry
   the same palette outward to fill the screen.

   Timeline:
     0.0 - 1.0s   the orchid ring unfurls, staggered 0.05s apart
     0.35 - 1.25s the logo fades up in the centre as it opens
     0.8 - 1.5s   two rose blooms offset for depth
     1.1 - 1.7s   a green mini-bloom, the quietest layer
     2.0 - 2.5s   fades out, revealing the app

   Pure CSS keyframes and SVG. The exit is a class rather than a keyframe on a
   timer, so a slow account read holds the frame instead of fading to nothing. */
import React from "react";

/* A petal in the outer band: r=26 to r=2 of a 120 viewBox, so the middle stays
   clear for the logo. transform-origin at the centre means scaling from 0
   unfurls it outward. */
const PETAL = "M60 26 C 51 19, 52.5 9, 60 2 C 67.5 9, 69 19, 60 26 Z";

function Ring({ id, size, petals = 8, delay = 0, from, to, className = "" }) {
  return (
    <svg className={`bloom ${className}`} width={size} height={size} viewBox="0 0 120 120"
      aria-hidden="true" focusable="false">
      <defs>
        {/* userSpaceOnUse so the wash runs across the whole ring rather than
            restarting inside every petal's own box. */}
        <linearGradient id={`petal-${id}`} x1="10" y1="10" x2="110" y2="110" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={from} />
          <stop offset="100%" stopColor={to} />
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
  { x: -70, d: 0.55, t: 2.6, s: 2.5 }, { x: -38, d: 0.82, t: 3.0, s: 2 },
  { x: -14, d: 0.66, t: 2.7, s: 2 },   { x: 18,  d: 0.96, t: 3.2, s: 2.5 },
  { x: 44,  d: 0.74, t: 2.8, s: 2 },   { x: 72,  d: 1.06, t: 2.6, s: 2 },
];

export default function Splash({ leaving = false, reduced = false }) {
  return (
    <div className={`splash${leaving ? " splash--out" : ""}${reduced ? " splash--still" : ""}`}
      role="status" aria-live="polite" aria-label="Loading Flourish">

      <div className="splash-stage">
        {!reduced && (
          <>
            {/* orchid, the anchor */}
            <Ring id="main" size={392} petals={8} className="bloom--main"
              from="#8E5BC4" to="#B57EDC" />
            {/* rose, softer and offset for depth */}
            <Ring id="a" size={116} petals={7} delay={0.82} className="bloom--tl"
              from="#E89AC7" to="#F6C9E0" />
            <Ring id="b" size={96} petals={7} delay={1.02} className="bloom--br"
              from="#E89AC7" to="#F6C9E0" />
            {/* leaf, the quietest layer */}
            <Ring id="c" size={78} petals={6} delay={1.14} className="bloom--leaf"
              from="#AED06A" to="#AED86A" />

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
            still says what it is if the image fails to load.
            WebP first — the PNG is three times the bytes and was not arriving
            before the splash finished, leaving the ring circling an empty
            centre. Preloaded in index.html so it starts with the HTML. */}
        <picture>
          <source srcSet="/logo-mark.webp" type="image/webp" />
          <img className="splash-logo" src="/logo-mark.png" alt="Flourish"
            width={286} height={190} decoding="async" fetchPriority="high" />
        </picture>
      </div>

      <div className="splash-sub">Bronx, NY</div>
    </div>
  );
}
