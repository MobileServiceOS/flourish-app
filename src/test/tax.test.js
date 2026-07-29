import { describe, it, expect } from "vitest";
import { TAX_RATE, TAX_LABEL, taxOn, withTax, cents, money } from "../lib/money.js";

describe("sales tax", () => {
  it("is 8.875% — the combined New York City rate on prepared food", () => {
    expect(TAX_RATE).toBe(0.08875);
    expect(TAX_LABEL).toBe("8.875%");
  });

  it("applies to the order", () => {
    expect(taxOn(20)).toBe(1.78);
    expect(taxOn(100)).toBe(8.88);
    expect(withTax(20)).toBe(21.78);
  });

  it("rounds half-up to the cent, matching the register", () => {
    // 20 * 0.08875 = 1.775 exactly — plain toFixed drops that to 1.77
    expect(taxOn(20)).toBe(1.78);
    // 15.99 * 0.08875 = 1.4191... -> 1.42
    expect(taxOn(15.99)).toBe(1.42);
    expect(money(withTax(15.99))).toBe("$17.41");
  });

  it("taxes nothing on an empty order", () => {
    expect(taxOn(0)).toBe(0);
    expect(withTax(0)).toBe(0);
  });

  it("is applied after a reward discount, not before", () => {
    // $20 plate, $6 reward -> tax on $14, not on $20
    const net = cents(20 - 6);
    expect(taxOn(net)).toBe(1.24);
    expect(taxOn(net)).not.toBe(taxOn(20));
  });
});

describe("the rate lives in exactly one place", () => {
  it("is never written out as a literal anywhere in the app", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { resolve, dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");

    const walk = (d) => readdirSync(d, { withFileTypes: true })
      .flatMap((e) => e.name === "test" ? []
        : e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);

    // Any bare tax-rate-looking literal outside money.js means two sources of
    // truth, which is how the checkout total and the card charge drift apart.
    const offenders = walk(SRC)
      .filter((f) => /\.jsx?$/.test(f) && !/lib\/money\.js$/.test(f))
      .filter((f) => /[^.\d](0\.085|1\.085|0\.08875|1\.08875)\b/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(SRC.length + 1));
    expect(offenders).toEqual([]);
  });
});
