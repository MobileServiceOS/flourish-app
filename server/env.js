/* Server configuration.

   CLOVER_PRIVATE_TOKEN lives here and nowhere else. It has no VITE_ prefix on
   purpose: Vite inlines every VITE_* variable into the browser bundle, so a
   prefix would ship the token to every customer.

   Nothing in this file logs a token. `describe()` exists so startup can print
   something useful without printing a secret. */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
config({ path: resolve(ROOT, ".env.local") });

const clean = (v) => String(v ?? "").trim().replace(/^["']|["']$/g, "");

// A trailing slash pasted onto the merchant id builds URLs like
// /v3/merchants/ABC123//items, which Clover rejects. Strip it rather than
// leaving a copy-paste artifact to fail at 2am.
export const MERCHANT_ID = clean(process.env.VITE_CLOVER_MERCHANT_ID).replace(/^\/+|\/+$/g, "");
export const PRIVATE_TOKEN = clean(process.env.CLOVER_PRIVATE_TOKEN);
export const API_BASE = clean(process.env.CLOVER_API_BASE).replace(/\/+$/, "");
export const PORT = Number(clean(process.env.PORT)) || 3001;

export const IS_SANDBOX = /sandbox|dev\.clover/i.test(API_BASE);

/* Ecommerce charges go to a different host than the platform API. */
export const ECOMM_BASE = IS_SANDBOX
  ? "https://scl-sandbox.dev.clover.com"
  : "https://scl.clover.com";

export const CONFIGURED = Boolean(MERCHANT_ID && PRIVATE_TOKEN && API_BASE);

/* Allowing a live charge requires deliberately opting out of the guard rail,
   so a stray .env edit cannot start billing real cards. */
export const ALLOW_PRODUCTION = clean(process.env.CLOVER_ALLOW_PRODUCTION) === "yes";

export function assertSafeTarget() {
  if (!IS_SANDBOX && !ALLOW_PRODUCTION) {
    throw new Error(
      `Refusing to start against a non-sandbox Clover API (${API_BASE}).\n` +
      `If this is intentional, set CLOVER_ALLOW_PRODUCTION=yes in .env.local.`
    );
  }
}

/** Safe to print. Never includes a token. */
export const describe = () => ({
  apiBase: API_BASE || "(unset)",
  merchantId: MERCHANT_ID ? `${MERCHANT_ID.slice(0, 4)}…` : "(unset)",
  environment: IS_SANDBOX ? "sandbox" : "PRODUCTION",
  configured: CONFIGURED,
});
