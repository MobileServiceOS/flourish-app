import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/* WCAG 2.1 relative luminance and contrast ratio.
   AA is 4.5:1 for body text, 3:1 for text >=18.66px bold or >=24px, and
   3:1 for the boundary of an interactive control. */

const hex = (h) => {
  const s = h.replace("#", "");
  const n = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
};

const lum = (rgb) => {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const ratio = (fg, bg) => {
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
};

/** Flatten a translucent colour onto an opaque one. */
const over = (rgb, alpha, bg) => rgb.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));

// Pull the tokens straight out of the stylesheet so the test tracks the real values.
const CSS = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../styles.css"), "utf8"
);
const token = (name) => {
  const m = CSS.match(new RegExp(`--${name}\\s*:\\s*(#[0-9A-Fa-f]{3,6})`));
  if (!m) throw new Error(`token --${name} not found in styles.css`);
  return hex(m[1]);
};

const WHITE = [255, 255, 255];
const PAPER = token("paper");
const INK = token("ink");
const MUTED = token("muted");

// Tinted pill backgrounds, as they actually composite over white.
const TEAL_TINT = over(hex("#2FB6A8"), 0.12, WHITE);
const PINK_TINT = over(hex("#E89AC7"), 0.22, WHITE);
const ORCHID_TINT = over(hex("#8E5BC4"), 0.16, WHITE);
const LEAF_TINT = over(hex("#7FB93E"), 0.12, WHITE);

const AA = 4.5;

describe("body text clears WCAG AA (4.5:1)", () => {
  const cases = [
    ["--ink on white", INK, WHITE],
    ["--ink on --paper", INK, PAPER],
    ["--muted on white", MUTED, PAPER],
    ["--muted on --paper", MUTED, PAPER],
    ["--orchid-ink on white (prices, links)", token("orchid-ink"), WHITE],
    ["--orchid-ink on --paper (active tab)", token("orchid-ink"), PAPER],
    ["--leaf-ink on white (savings, points)", token("leaf-ink"), WHITE],
    ["--teal-ink on the teal badge", token("teal-ink"), TEAL_TINT],
    ["--rose-ink on the pink badge", token("rose-ink"), PINK_TINT],
    ["--plum-ink on the orchid badge", token("plum-ink"), ORCHID_TINT],
    ["--leaf-ink on the leaf badge", token("leaf-ink"), LEAF_TINT],
  ];
  for (const [label, fg, bg] of cases) {
    it(label, () => expect(ratio(fg, bg)).toBeGreaterThanOrEqual(AA));
  }
});

describe("white text on filled buttons clears AA", () => {
  // .pill-btn is a left-to-right gradient; the darkest requirement is its
  // lightest stop, so both ends are checked.
  const cases = [
    ["gradient start --orchid", token("orchid")],
    ["gradient end --pink-deep", token("pink-deep")],
    ["reward card end --teal-deep", token("teal-deep")],
    ["cart badge --alert", token("alert")],
  ];
  for (const [label, bg] of cases) {
    it(label, () => expect(ratio(WHITE, bg)).toBeGreaterThanOrEqual(AA));
  }
});

describe("regression guards", () => {
  it("keeps the old --pink out of button fills — white on it was 2.1:1", () => {
    expect(ratio(WHITE, hex("#E89AC7"))).toBeLessThan(3);
    expect(CSS).not.toMatch(/\.pill-btn\{[^}]*var\(--pink\)/);
  });

  it("keeps the old --muted value out — it was 3.6:1 on paper", () => {
    expect(ratio(hex("#8A7E96"), PAPER)).toBeLessThan(AA);
  });

  it("uses no raw low-contrast hex literals in the stylesheet", () => {
    for (const bad of ["#8A7E96", "#1f8f83"]) {
      expect(CSS).not.toContain(bad);
    }
  });
});
