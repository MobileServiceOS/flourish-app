// Half-up rounding to cents. Plain toFixed drops a penny on exact halves
// (20 * 0.08875 = 1.775 -> "1.77"), which would desync totals from the register.
export const cents = (n) => Math.round((n + 1e-9) * 100) / 100;
export const money = (n) => `$${cents(n).toFixed(2)}`;
