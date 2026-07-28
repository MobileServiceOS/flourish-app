// Half-up rounding to cents. Plain toFixed drops a penny on exact halves
// (20 * 0.085 = 1.7 is fine, but 15.99 * 0.085 = 1.35915 is not), which would
// desync totals from the register.
export const cents = (n) => Math.round((n + 1e-9) * 100) / 100;
export const money = (n) => `$${cents(n).toFixed(2)}`;

/* Sales tax.

   One constant, used everywhere. It was previously written out as a bare
   0.08875 in three separate places, which is how the number shown at checkout
   and the number charged to the card drift apart.

   IMPORTANT — this rate is only ever an *estimate shown to the customer*. It is
   deliberately not sent to Clover: the atomic order carries no tax field, and
   Clover applies the merchant's own tax rules when it prices the order. So this
   number has to match the tax rate configured in the Clover dashboard, or the
   customer sees one total at checkout and the register rings up another.

   Set to 8.5% on request. Note that the combined New York City rate on prepared
   food is 8.875% (4% state + 4.5% city + 0.375% MCTD surcharge); if 8.5% is not
   deliberate, the difference comes out of the restaurant's own pocket at filing
   time. */
export const TAX_RATE = 0.085;

/** Tax on an amount, rounded to cents. */
export const taxOn = (amount) => cents(amount * TAX_RATE);

/** Amount plus tax. */
export const withTax = (amount) => cents(amount + taxOn(amount));

/** "8.5%" — for showing the customer which rate they are being quoted. */
export const TAX_LABEL = `${Number((TAX_RATE * 100).toFixed(4))}%`;
