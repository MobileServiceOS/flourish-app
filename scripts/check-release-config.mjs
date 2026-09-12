#!/usr/bin/env node
/**
 * Refuse to build a shippable app that cannot reach the kitchen.
 *
 * The failure this exists to prevent is silent and total: a Capacitor web view
 * loads from `capacitor://localhost`, so a relative "/api/clover/..." resolves
 * against that and reaches nothing. The app does not crash — it decides the
 * proxy is down and shows "ordering not available right now" to every customer
 * who ever opens it, and it does that just as convincingly in TestFlight as on
 * the App Store.
 *
 * There is no way to notice that from the code. So it is checked here, before
 * the build, and the build stops.
 *
 * Run by `npm run release:ios`. Development is untouched: `npm run dev` wants
 * VITE_API_BASE unset so the fetch stays relative and Vite proxies it.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/* Normally the project root. Overridable so this gate's OWN tests can point it
   at an empty fixture directory: they assert it fails when VITE_API_BASE is
   unset, and once a developer has a real .env.production.local — which they
   need in order to build a release at all — the gate correctly passes and the
   test that proves it can fail no longer proves anything. The override is read
   from the environment rather than argv so a release build cannot pick it up by
   accident from a stray flag. */
const ROOT = process.env.RELEASE_CHECK_ROOT
  ? resolve(process.env.RELEASE_CHECK_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
const notes = [];

/* Vite reads VITE_* from the process env and from .env files. Mirror the
   subset of that resolution the release path actually uses, so this check sees
   what the build will see. */
const fromEnvFiles = (key) => {
  for (const f of [".env.production.local", ".env.production", ".env.local", ".env"]) {
    const path = resolve(ROOT, f);
    if (!existsSync(path)) continue;
    const line = readFileSync(path, "utf8")
      .split("\n")
      .find((l) => l.trim().startsWith(`${key}=`));
    if (line) return { value: line.slice(line.indexOf("=") + 1).trim(), from: f };
  }
  return null;
};

const resolveVar = (key) => {
  if (process.env[key]) return { value: process.env[key].trim(), from: "the environment" };
  return fromEnvFiles(key);
};

const apiBase = resolveVar("VITE_API_BASE");
const appKey = resolveVar("VITE_APP_KEY");

/* ---- the one that breaks everything ---- */
if (!apiBase || !apiBase.value) {
  problems.push(
    "VITE_API_BASE is not set.\n" +
    "    A shipped app has no Vite proxy, so a relative /api call reaches nothing\n" +
    "    and every customer sees \"ordering not available right now\".\n" +
    "    Set it to the hosted proxy, e.g.\n" +
    "      VITE_API_BASE=https://flourish-proxy.up.railway.app npm run release:ios"
  );
} else {
  const url = apiBase.value;
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url)) {
    problems.push(
      `VITE_API_BASE points at your own machine (${url}).\n` +
      "    That works on the simulator and for nobody else. Use the hosted URL."
    );
  } else if (!/^https:\/\//.test(url)) {
    problems.push(
      `VITE_API_BASE must be https (got ${url}).\n` +
      "    iOS App Transport Security blocks plain http, so every call fails."
    );
  } else if (url.endsWith("/")) {
    // Harmless — the client strips it — but it means the value was pasted
    // rather than checked, so say so.
    notes.push(`VITE_API_BASE has a trailing slash (${url}); it is stripped at runtime.`);
  }
}

/* ---- the one that gets you turned away at the door ---- */
if (!appKey || !appKey.value) {
  problems.push(
    "VITE_APP_KEY is not set.\n" +
    "    The hosted proxy refuses remote callers without it, so the app would\n" +
    "    reach the server and be rejected. It must equal APP_KEY on the host.\n" +
    "    It is NOT a secret — it ships in the bundle and only turns away scanners."
  );
}

/* ---- never ship the private token ---- */
if (process.env.VITE_CLOVER_PRIVATE_TOKEN || fromEnvFiles("VITE_CLOVER_PRIVATE_TOKEN")) {
  problems.push(
    "VITE_CLOVER_PRIVATE_TOKEN exists. Any VITE_ variable is inlined into the\n" +
    "    browser bundle. That token can charge cards; it must never leave the server."
  );
}

/* ---- what the customer will be told they are connected to ---- */
const cloverBase = resolveVar("CLOVER_API_BASE");
if (cloverBase && /sandbox|dev\.clover/i.test(cloverBase.value)) {
  notes.push(
    "CLOVER_API_BASE is a sandbox host. That only affects the server, not this\n" +
    "    build — but make sure the HOSTED proxy points at production."
  );
}

/* ---------- report ---------- */
if (notes.length) {
  console.log("\n  Worth knowing:");
  for (const n of notes) console.log(`  - ${n}`);
}

if (problems.length) {
  console.error(`\n  Not ready to build a release. ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  - ${p}\n`);
  console.error("  Fix these, then run it again. Nothing was built.\n");
  process.exit(1);
}

console.log("\n  Release config OK");
console.log(`  API      ${apiBase.value}   (from ${apiBase.from})`);
console.log(`  App key  set             (from ${appKey.from})`);
console.log("");
