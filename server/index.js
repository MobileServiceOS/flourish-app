#!/usr/bin/env node
/* Entry point for the Clover proxy.
   Run with `npm run server`, or `npm run dev:all` alongside the frontend. */

/* Opening hours are New York wall-clock, and the proxy refuses orders outside
   them. Railway, Fly and most containers run in UTC, where 11am-10pm local would
   put the Bronx open from 6am — so pin the zone before anything reads a clock.
   Must come before any other import that might touch Date. */
const TZ_FROM_HOST = Boolean(process.env.TZ);
process.env.TZ = process.env.TZ || "America/New_York";

import { createApp } from "./app.js";
import { resolvePrinter, describePrinter, probeMessaging, printEventUrl } from "./clover.js";
import { PORT, CONFIGURED, IS_SANDBOX, assertSafeTarget, describe } from "./env.js";
import { describeGuard, ALLOWED_ORIGINS } from "./guard.js";
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
  /* These are warnings about a half-configured server, and a correctly deployed
     one must boot without any of them. Seeing them in a hosting dashboard means
     something in the environment is missing. */
  const warnings = [];
  if (g.appKey.startsWith("unset")) {
    warnings.push([
      "No APP_KEY, so remote requests are refused outright.",
      "Set APP_KEY and ALLOWED_ORIGINS before hosting this anywhere.",
    ]);
  }
  if (!ALLOWED_ORIGINS.length) {
    warnings.push([
      "No ALLOWED_ORIGINS, so any origin is accepted.",
      "Set it to the app's own domain before hosting this anywhere.",
    ]);
  }
  if (!CONFIGURED) {
    warnings.push([
      "Clover credentials are missing.",
      "The app will run in preview mode: browsing works, ordering is disabled.",
    ]);
  }
  /* The pin above means the zone is always right; this says the HOST did not
     set it, which is worth knowing on a platform where someone might later
     change the start command and lose the pin with it. */
  if (!TZ_FROM_HOST) {
    warnings.push([
      "TZ was not set by the host — falling back to America/New_York.",
      "Set TZ=America/New_York in the host's environment so it does not",
      "depend on this file pinning it.",
    ]);
  }

  for (const lines of warnings) {
    console.log("");
    for (const l of lines) console.log(`  ${l}`);
  }
  if (!warnings.length) console.log("  Config   complete — no warnings");
  console.log("");
  reportPrinter();
  /* Detected once, here, so it never warns per order again. It prints its own
     single line when the feature is absent. */
  probeMessaging().catch(() => {});
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
    // The URL tickets actually go to, so a wrong one is visible on every boot
    // rather than only in the failure it causes.
    console.log(`  Print to POST ${printEventUrl()}`);
    console.log("");
  } catch (e) {
    console.warn(`  Printer  could not be read from Clover (${e?.message ?? "unknown"})\n`);
  }
}
