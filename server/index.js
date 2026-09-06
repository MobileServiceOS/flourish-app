#!/usr/bin/env node
/* Entry point for the Clover proxy.
   Run with `npm run server`, or `npm run dev:all` alongside the frontend. */

/* Opening hours are New York wall-clock, and the proxy refuses orders outside
   them. Railway, Fly and most containers run in UTC, where 11am-10pm local would
   put the Bronx open from 6am — so pin the zone before anything reads a clock.
   Must come before any other import that might touch Date. */
process.env.TZ = process.env.TZ || "America/New_York";

import { createApp } from "./app.js";
import { resolvePrinter, describePrinter } from "./clover.js";
import { PORT, CONFIGURED, IS_SANDBOX, assertSafeTarget, describe } from "./env.js";
import { describeGuard } from "./guard.js";
import { HOURS_LINE } from "../src/lib/hours.js";

try {
  assertSafeTarget();
} catch (e) {
  console.error(`\n  ${e.message}\n`);
  process.exit(1);
}

createApp().listen(PORT, () => {
  const d = describe();
  console.log(`\n  Flourish · Clover proxy on http://localhost:${PORT}`);
  console.log(`  API      ${d.apiBase}`);
  console.log(`  Merchant ${d.merchantId}`);
  console.log(`  Mode     ${IS_SANDBOX ? "SANDBOX — test orders only" : "PRODUCTION — real money"}`);
  console.log(`  Hours    ${HOURS_LINE}  (${process.env.TZ})`);
  const g = describeGuard();
  console.log(`  App key  ${g.appKey}`);
  console.log(`  Origins  ${g.origins}`);
  console.log(`  Max      ${g.maxCharge} per order`);
  if (g.appKey.startsWith("unset")) {
    console.log("\n  No APP_KEY, so remote requests are refused outright.");
    console.log("  Set APP_KEY and ALLOWED_ORIGINS before hosting this anywhere.");
  }
  if (!CONFIGURED) {
    console.log("\n  Clover credentials are missing from .env.local.");
    console.log("  The app will run in preview mode: browsing works, ordering is disabled.");
  }
  console.log("");
  reportPrinter();
});

/* Which printer the kitchen ticket will go to, said out loud at startup.
   A silent printer is how an order reaches Clover and never reaches the
   kitchen, so this is worth a line on every boot. */
async function reportPrinter() {
  if (!CONFIGURED) return;
  try {
    const { printer, printers } = await resolvePrinter();
    if (!printer) {
      console.error("  PRINTER  none — Clover lists no printers for this merchant.");
      console.error("           Kitchen tickets will NOT print. Pair one in the Clover");
      console.error("           dashboard, or set CLOVER_PRINTER_UUID in .env.local.\n");
      return;
    }
    const d = describePrinter(printer);
    const others = printers.length - 1;
    console.log(
      `  Printer  ${d.name ?? "(unnamed)"} · ${d.uuid} · type ${d.type ?? "(none)"}` +
      (others > 0 ? `  (+${others} other${others > 1 ? "s" : ""})` : "")
    );
    console.log("");
  } catch (e) {
    console.warn(`  Printer  could not be read from Clover (${e?.message ?? "unknown"})\n`);
  }
}
