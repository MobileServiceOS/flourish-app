#!/usr/bin/env node
/**
 * Grant or correct a Petals balance.
 *
 *   PETALS_ADMIN_KEY=... APP_KEY=... node scripts/petals-grant.mjs \
 *     --phone 4757776200 --name "Nevaeh Reid" --petals 1000 \
 *     --reason "test account" --key test-1000
 *
 *   node scripts/petals-grant.mjs --perks-match --phone 4757776200 \
 *     --name "Nevaeh Reid" --petals 140
 *
 * --perks-match is the Clover Perks balance match, which has no staff screen:
 * fewer than ten are expected, so they are run by hand. It is capped at 200 in
 * the ledger however much is typed, it is once per phone number ever, and the
 * row reads "perks match".
 *
 * TWO KEYS ARE REQUIRED, and they do different jobs.
 *
 *   APP_KEY           the proxy's perimeter. Every /api/clover path except
 *                     /health sits behind it, so a request without it is
 *                     refused with 401 BAD_APP_KEY before routing even
 *                     happens — which is why a missing route and a missing app
 *                     key look identical from outside. It is NOT a secret: it
 *                     ships inside the app bundle and only turns away scanners.
 *   PETALS_ADMIN_KEY  the real control. This endpoint mints currency, so it
 *                     needs a secret that exists only on the host, and the
 *                     route does not exist at all when it is unset.
 *
 * Both values are on the Railway service. Read them there; never paste them
 * into a file, a commit or a chat.
 *
 * Every grant is a ledger row carrying the reason and an idempotency key, so it
 * behaves exactly like earned Petals and can be explained later. Re-running the
 * same --key is a no-op rather than a second grant, which is what makes it safe
 * to retry when a response goes missing.
 *
 * The admin key is a real secret and lives only on the host. It is read from the
 * environment and never printed.
 */
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : d;
};

const base = (arg("api", process.env.PETALS_API ?? "https://flourish-api-production.up.railway.app")).replace(/\/$/, "");
const adminKey = process.env.PETALS_ADMIN_KEY;
const appKey = process.env.APP_KEY ?? process.env.VITE_APP_KEY;
const phone = arg("phone");
const petals = Number(arg("petals"));
const reason = arg("reason");
const key = arg("key");
const name = arg("name", "");

/* A Perks match is a grant with rules of its own, so it gets a mode rather than
   a second script: capped at 200 in the LEDGER, once per phone number ever, and
   recorded with reason "perks match" so a balance can be taken apart later.
   There is no staff screen for this — fewer than ten are expected, and a
   permanent surface in the customer app for a ten-time job is not worth it. */
const perksMatch = process.argv.includes("--perks-match");

if (!adminKey) {
  console.error("\n  PETALS_ADMIN_KEY is not set. It is a secret and lives on the host.\n");
  process.exit(1);
}
if (!appKey) {
  console.error(
    "\n  APP_KEY is not set. Every /api/clover path except /health sits behind it,\n" +
    "  so without it this is refused with 401 before the route is even reached.\n" +
    "  It is not a secret — it ships in the app bundle — but it is required.\n"
  );
  process.exit(1);
}
const required = perksMatch
  ? [["--phone", phone], ["--petals", petals]]
  : [["--phone", phone], ["--petals", petals], ["--reason", reason], ["--key", key]];
for (const [label, v] of required) {
  if (v === undefined || v === "" || (label === "--petals" && !Number.isFinite(v))) {
    console.error(`\n  ${label} is required.\n  Example:\n` +
      (perksMatch
        ? `    node scripts/petals-grant.mjs --perks-match --phone 4757776200 \\\n` +
          `      --name "Nevaeh Reid" --petals 140\n\n` +
          `  --reason and --key are not used: a Perks match has one reason and one\n` +
          `  key by definition, and the ledger caps it at 200 however much is typed.\n`
        : `    node scripts/petals-grant.mjs --phone 4757776200 --name "Nevaeh Reid" \\\n` +
          `      --petals 1000 --reason "test account" --key test-1000\n`));
    process.exit(1);
  }
}

const res = await fetch(
  `${base}/api/clover/petals/${perksMatch ? "perks-match" : "adjust"}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-flourish-key": appKey,          // the perimeter
      "x-petals-admin-key": adminKey,    // the control
    },
    body: JSON.stringify(perksMatch
      ? { name, phone, petals, staff: arg("staff", "") }
      : { name, phone, delta: petals, reason, idempotencyKey: key }),
  });
const body = await res.json().catch(() => ({}));

if (!res.ok) {
  console.error(`\n  ${res.status} ${body.code ?? ""} — ${body.error ?? "no detail"}`);
  /* These three are the ones that actually happen, and each has a different
     fix — worth saying which rather than leaving a bare status code. */
  if (body.code === "BAD_APP_KEY") {
    console.error("  That is the APP_KEY, not the admin key. Check it matches the host's.");
  } else if (body.code === "ADJUST_DISABLED") {
    console.error("  PETALS_ADMIN_KEY is not set ON THE HOST, so the route does not exist.");
  } else if (body.code === "ADJUST_FORBIDDEN") {
    console.error("  The admin key was sent but did not match the host's.");
  } else if (res.status === 404) {
    console.error("  The route is missing — is the deployed proxy older than this branch?");
  }
  console.error("");
  process.exit(1);
}
if (perksMatch) {
  console.log(
    `\n  +${body.credited} Petals` +
    `${body.capped ? ` (asked ${body.asked}, capped at the 200 ceiling)` : ""}` +
    `${body.alreadyMatched ? " — this number was already matched, nothing changed" : ""}` +
    `\n  balance is now ${body.petals}\n`
  );
} else {
  console.log(
    `\n  ${body.applied >= 0 ? "+" : ""}${body.applied} Petals` +
    `${body.alreadyApplied ? " (already applied — this key was used before)" : ""}` +
    `\n  balance is now ${body.petals}\n`
  );
}
