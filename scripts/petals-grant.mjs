#!/usr/bin/env node
/**
 * Grant or correct a Petals balance.
 *
 *   PETALS_ADMIN_KEY=... node scripts/petals-grant.mjs \
 *     --phone 4757776200 --name "Nevaeh Reid" --petals 1000 \
 *     --reason "test account" --key test-1000
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
const phone = arg("phone");
const petals = Number(arg("petals"));
const reason = arg("reason");
const key = arg("key");
const name = arg("name", "");

if (!adminKey) {
  console.error("\n  PETALS_ADMIN_KEY is not set. It is a secret and lives on the host.\n");
  process.exit(1);
}
for (const [label, v] of [["--phone", phone], ["--petals", petals], ["--reason", reason], ["--key", key]]) {
  if (v === undefined || v === "" || (label === "--petals" && !Number.isFinite(v))) {
    console.error(`\n  ${label} is required.\n  Example:\n` +
      `    node scripts/petals-grant.mjs --phone 4757776200 --name "Nevaeh Reid" \\\n` +
      `      --petals 1000 --reason "test account" --key test-1000\n`);
    process.exit(1);
  }
}

const res = await fetch(`${base}/api/clover/petals/adjust`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-petals-admin-key": adminKey },
  body: JSON.stringify({ name, phone, delta: petals, reason, idempotencyKey: key }),
});
const body = await res.json().catch(() => ({}));

if (!res.ok) {
  console.error(`\n  ${res.status} ${body.code ?? ""} — ${body.error ?? "no detail"}\n`);
  process.exit(1);
}
console.log(
  `\n  ${body.applied >= 0 ? "+" : ""}${body.applied} Petals` +
  `${body.alreadyApplied ? " (already applied — this key was used before)" : ""}` +
  `\n  balance is now ${body.petals}\n`
);
