#!/usr/bin/env node
/* Entry point for the Clover proxy.
   Run with `npm run server`, or `npm run dev:all` alongside the frontend. */
import { createApp } from "./app.js";
import { PORT, CONFIGURED, IS_SANDBOX, assertSafeTarget, describe } from "./env.js";
import { describeGuard } from "./guard.js";

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
});
