#!/usr/bin/env node
/**
 * Pay the signup bonus to every customer already in the ledger who never got
 * one — the retroactive half of the 50-Petal signup bonus.
 *
 *   node scripts/petals-backfill-signup.mjs                 # DRY RUN, writes nothing
 *   node scripts/petals-backfill-signup.mjs --run           # actually credit
 *   node scripts/petals-backfill-signup.mjs --run --limit 50
 *
 * DRY RUN IS THE DEFAULT, and `--run` is the only way past it. This mints
 * currency for every customer in the database at once, so the shape that costs
 * nothing has to be the one you get by typing less, not more.
 *
 * WHY THIS CALLS THE SERVER INSTEAD OF THE DATABASE. Railway's Postgres is on
 * an internal hostname with no public proxy, so a script on a laptop cannot
 * reach it at all. The work therefore happens on the host, and this is a
 * client for it — which also means it runs from a phone over SSH, or from
 * anywhere with curl, without anybody handling a database URL.
 *
 * TWO KEYS, doing different jobs — the same pair petals-grant.mjs needs:
 *
 *   APP_KEY           the perimeter. Every /api/clover path except /health is
 *                     behind it and it runs BEFORE routing, so a missing route
 *                     and a missing app key both come back 401 BAD_APP_KEY and
 *                     look identical from outside. Not a secret: it ships in
 *                     the app bundle.
 *   PETALS_ADMIN_KEY  the control. A real secret, host-only. The route does not
 *                     exist at all when it is unset.
 *
 * Both are on the Railway service. Read them there; never paste either into a
 * file, a commit or a chat.
 *
 * IT IS SAFE TO RUN TWICE. The bonus is keyed `signup:<phone>` with a unique
 * index behind it, and the backfill uses the very same helper the live signup
 * path uses — so a customer credited here and then opening the app is credited
 * once, and a second run credits nobody.
 */
const BASE = (process.env.API_BASE ?? "https://flourish-api-production.up.railway.app")
  .replace(/\/$/, "");
const APP_KEY = process.env.APP_KEY ?? process.env.VITE_APP_KEY ?? "";
const ADMIN_KEY = process.env.PETALS_ADMIN_KEY ?? "";

const args = process.argv.slice(2);
const run = args.includes("--run");
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : undefined;

function bail(message, extra = "") {
  console.error(`\n  ${message}\n${extra ? `  ${extra}\n` : ""}`);
  process.exit(1);
}

if (!APP_KEY) {
  bail("APP_KEY is not set.",
       "Read it from the Railway service and pass it in the environment.");
}
if (!ADMIN_KEY) {
  bail("PETALS_ADMIN_KEY is not set.",
       "It is a real secret and lives only on the host. The route 404s without it.");
}

const res = await fetch(`${BASE}/api/clover/petals/backfill-signup`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-flourish-key": APP_KEY,
    "x-petals-admin-key": ADMIN_KEY,
  },
  body: JSON.stringify({ dryRun: !run, ...(limit ? { limit } : {}) }),
});

const body = await res.json().catch(() => ({}));

if (!res.ok) {
  /* Each failure says which of the two keys is the problem, because the codes
     are otherwise indistinguishable from "you typed the URL wrong". */
  const why = {
    BAD_APP_KEY: "APP_KEY is wrong or missing — that guard runs before routing, "
               + "so this looks the same as a URL that does not exist.",
    ADJUST_FORBIDDEN: "PETALS_ADMIN_KEY is wrong.",
    ADJUST_DISABLED: "PETALS_ADMIN_KEY is not set on the host, so the route does not exist.",
    PETALS_OFF: "Server-side Petals are off — DATABASE_URL is not set on the host.",
  }[body?.code];
  bail(`${res.status} ${body?.code ?? ""} ${body?.error ?? ""}`.trim(), why ?? "");
}

const n = (v) => String(v ?? 0).padStart(5);
console.log("");
if (body.dryRun) {
  console.log("  DRY RUN — nothing was written.\n");
  console.log(`  ${n(body.customers)}  customers in the ledger`);
  console.log(`  ${n(body.alreadyHave)}  already have a signup bonus`);
  console.log(`  ${n(body.wouldCredit)}  WOULD be credited`);
  console.log(`  ${n(body.petals)}  Petals would be created`
            + `  (about $${(Number(body.petals) * 0.05).toFixed(2)} at 5c each)`);
  console.log("\n  Re-run with --run to apply it.\n");
} else {
  console.log("  Applied.\n");
  console.log(`  ${n(body.customers)}  customers in the ledger`);
  console.log(`  ${n(body.alreadyHave)}  already had one`);
  console.log(`  ${n(body.credited)}  credited now`);
  console.log(`  ${n(body.petals)}  Petals created`
            + `  (about $${(Number(body.petals) * 0.05).toFixed(2)} at 5c each)`);
  if (body.skipped) {
    console.log(`  ${n(body.skipped)}  skipped — credited by the live path mid-run`);
  }
  console.log("\n  Safe to run again; it will credit nobody twice.\n");
}
