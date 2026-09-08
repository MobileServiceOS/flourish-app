import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

/* ============================================================================
   SHIPPING IT

   The failure that matters here is silent and total: a Capacitor web view loads
   from `capacitor://localhost`, so a relative "/api/clover/..." resolves against
   THAT and reaches nothing. The app does not crash — it decides the proxy is
   down and shows "ordering not available right now" to every customer who ever
   opens it, exactly as convincingly in TestFlight as on the App Store.
   ============================================================================ */

describe("the app knows where the proxy is", () => {
  afterEach(() => { vi.resetModules(); vi.unstubAllEnvs(); });

  it("uses a relative path in development, so Vite can proxy it", async () => {
    vi.stubEnv("VITE_API_BASE", "");
    vi.resetModules();
    const { API_BASE } = await import("../lib/clover.js");
    expect(API_BASE).toBe("");
  });

  it("prefixes every call with the hosted URL when one is configured", async () => {
    vi.stubEnv("VITE_API_BASE", "https://proxy.example.com");
    vi.resetModules();
    const clover = await import("../lib/clover.js");
    expect(clover.API_BASE).toBe("https://proxy.example.com");

    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => ({ ok: true, configured: true }) };
    }));
    await clover.health();

    expect(calls[0]).toBe("https://proxy.example.com/api/clover/health");
    vi.unstubAllGlobals();
  });

  it("tolerates a trailing slash rather than building a doubled one", async () => {
    vi.stubEnv("VITE_API_BASE", "https://proxy.example.com/");
    vi.resetModules();
    const { API_BASE } = await import("../lib/clover.js");
    expect(API_BASE).toBe("https://proxy.example.com");
  });

  it("is never hardcoded — no host name appears in the source", () => {
    /* Both halves come from the environment so one source tree builds a dev app
       and a store app. A pasted URL here would ship to the wrong place. */
    const src = readFileSync(resolve(ROOT, "src/lib/clover.js"), "utf8");
    expect(src).toContain("VITE_API_BASE");
    expect(src).not.toMatch(/https:\/\/[a-z0-9-]+\.(up\.railway\.app|fly\.dev)/);
  });
});

describe("the release gate refuses to build a broken app", () => {
  const check = (env) => {
    try {
      const out = execFileSync("node", [resolve(ROOT, "scripts/check-release-config.mjs")], {
        env: { ...process.env, VITE_API_BASE: "", VITE_APP_KEY: "", ...env },
        cwd: ROOT,
        encoding: "utf8",
      });
      return { code: 0, out };
    } catch (e) {
      return { code: e.status, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
    }
  };

  it("fails when the app has no idea where the proxy is", () => {
    const r = check({});
    expect(r.code).toBe(1);
    expect(r.out).toContain("VITE_API_BASE is not set");
  });

  it("fails when the build points at the developer's own laptop", () => {
    // Works on the simulator and for nobody else.
    const r = check({ VITE_API_BASE: "http://localhost:3001", VITE_APP_KEY: "k" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("points at your own machine");
  });

  it("fails on plain http, which iOS blocks outright", () => {
    const r = check({ VITE_API_BASE: "http://proxy.example.com", VITE_APP_KEY: "k" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("must be https");
  });

  it("fails without the app key the hosted proxy demands", () => {
    const r = check({ VITE_API_BASE: "https://proxy.example.com" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("VITE_APP_KEY is not set");
  });

  it("fails loudly if the private token was ever given a VITE_ prefix", () => {
    /* Any VITE_ variable is inlined into the bundle. That token can charge
       cards. */
    const r = check({
      VITE_API_BASE: "https://proxy.example.com",
      VITE_APP_KEY: "k",
      VITE_CLOVER_PRIVATE_TOKEN: "should-never-exist",
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain("must never leave the server");
  });

  it("passes on a real release configuration", () => {
    const r = check({ VITE_API_BASE: "https://proxy.example.com", VITE_APP_KEY: "k" });
    expect(r.code).toBe(0);
    expect(r.out).toContain("Release config OK");
  });
});

describe("the deploy configuration is committed, the secrets are not", () => {
  it("tells the host to start the proxy, never Vite", () => {
    const railway = JSON.parse(readFileSync(resolve(ROOT, "railway.json"), "utf8"));
    expect(railway.deploy.startCommand).toBe("node server/index.js");
    expect(railway.deploy.healthcheckPath).toBe("/api/clover/health");

    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
    // Hosts fall back to `npm start`; it must not launch a dev server.
    expect(pkg.scripts.start).toBe("node server/index.js");
    expect(pkg.scripts.start).not.toContain("vite");
  });

  it("stays portable, so the host is not baked into the code", () => {
    expect(readFileSync(resolve(ROOT, "Procfile"), "utf8")).toContain("node server/index.js");
  });

  it("commits no secrets", () => {
    for (const f of ["railway.json", "Procfile", "package.json", ".env.example"]) {
      const text = readFileSync(resolve(ROOT, f), "utf8");
      // The real token is 36 chars of uuid; nothing token-shaped belongs here.
      expect(text, f).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}/i);
      // On its own line only: an empty `CLOVER_PRIVATE_TOKEN=` placeholder is
      // the whole point of .env.example.
      expect(text, f).not.toMatch(/^CLOVER_PRIVATE_TOKEN[ \t]*=[ \t]*\S+/m);
    }
  });

  it("keeps .env.local and its editor backups out of git", () => {
    const ignore = readFileSync(resolve(ROOT, ".gitignore"), "utf8");
    expect(ignore).toMatch(/^\.env\.local$/m);
    expect(ignore).toMatch(/\*\.save/);
  });
});

/* ---------- the native app has to get past the front door ---------- */
describe("a native app is allowed through the origin check", () => {
  /* ALLOWED_ORIGINS is still read from the environment, so these tests set it —
     but the app key is injected rather than exported into process.env, which
     vitest shares between workers and which is how an unrelated suite started
     failing one run in nine. */
  let NATIVE_ORIGINS;

  const app = async ({ origins = "https://flourishbx.com", appKey } = {}) => {
    vi.resetModules();
    process.env.ALLOWED_ORIGINS = origins;
    const { createApp } = await import("../../server/app.js");
    const guard = await import("../../server/guard.js");
    ({ NATIVE_ORIGINS } = guard);
    guard.__resetRateLimit();
    const clover = {
      merchant: vi.fn().mockResolvedValue({ id: "M" }),
      items: vi.fn().mockResolvedValue({ elements: [] }),
      printers: vi.fn().mockResolvedValue({ elements: [] }),
      loyaltyProgram: vi.fn().mockRejectedValue(new Error("405")),
    };
    return request(createApp({
      clover, catalog: async () => ({}), appKey,
      now: () => new Date(2026, 6, 27, 12, 0),
    }));
  };

  let saved;
  beforeEach(() => { saved = process.env.ALLOWED_ORIGINS; });
  afterEach(() => {
    if (saved === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = saved;
  });

  it("lets the iOS app in even though its origin is not a website", async () => {
    /* The web view sends `capacitor://localhost`. With only the web domain in
       ALLOWED_ORIGINS every App Store customer would be 403'd while the website
       carried on working. A browser will not let a real site forge that scheme,
       which is why allowing it costs nothing. */
    const agent = await app();
    const r = await agent.get("/api/clover/health").set("Origin", "capacitor://localhost");
    expect(r.status).toBe(200);
  });

  it("still turns away a random website", async () => {
    const agent = await app();
    const r = await agent.get("/api/clover/health").set("Origin", "https://evil.example.com");
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("BAD_ORIGIN");
  });

  it("still lets the configured website in", async () => {
    const agent = await app();
    const r = await agent.get("/api/clover/health").set("Origin", "https://flourishbx.com");
    expect(r.status).toBe(200);
  });

  it("names both native schemes", async () => {
    await app();
    expect(NATIVE_ORIGINS).toContain("capacitor://localhost");
    expect(NATIVE_ORIGINS).toContain("ionic://localhost");
  });

  it("does not exempt a native origin from the app key", async () => {
    // Origin and authorisation are separate gates, and this must not become a
    // way around the second one.
    const agent = await app({ appKey: "s3cret" });
    const r = await agent.get("/api/clover/inventory").set("Origin", "capacitor://localhost");
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("BAD_APP_KEY");
  });

  it("lets the native app through once it presents the key", async () => {
    const agent = await app({ appKey: "s3cret" });
    const r = await agent.get("/api/clover/inventory")
      .set("Origin", "capacitor://localhost")
      .set("x-flourish-key", "s3cret");
    expect(r.status).not.toBe(401);
  });
});

/* ============================================================================
   THE STORE METADATA HAS TO MATCH THE APP

   Metadata describing food the kitchen stopped making, or a payment flow the
   app no longer has, is both an App Review rejection and a customer complaint.
   The listing had drifted on four counts before this was written.
   ============================================================================ */
describe("the App Store listing describes this app", () => {
  const listing = readFileSync(resolve(ROOT, "docs/app-store-listing.md"), "utf8");
  const privacy = readFileSync(resolve(ROOT, "docs/privacy.html"), "utf8");

  it("does not advertise food that is not on the menu", async () => {
    const { MENU } = await import("../data/menu.data.js");
    const names = MENU.flatMap((c) => c.items.map((i) => i.name.toLowerCase()));
    // Both patties are DELISTED in the generator; the listing named them.
    expect(names.some((n) => n.includes("patty"))).toBe(false);
    const copy = listing.slice(listing.indexOf("## Description"), listing.indexOf("## Keywords"));
    expect(copy.toLowerCase()).not.toMatch(/patt(y|ies)/);
  });

  it("does not keyword food that is not on the menu", () => {
    const kw = listing.split("\n").find((l) => l.startsWith("jamaican,"));
    expect(kw).toBeTruthy();
    expect(kw).not.toMatch(/patty/);
    // Apple counts commas and spaces; over 100 is silently truncated mid-word.
    expect(kw.length).toBeLessThanOrEqual(100);
    expect(kw).not.toMatch(/, /);
  });

  it("keeps the subtitle inside Apple's 30 characters", () => {
    const subtitle = /\*\*Subtitle\*\* \| ([^|]+) \|/.exec(listing)[1].trim();
    expect(subtitle.length).toBeLessThanOrEqual(30);
  });

  it("does not describe a card payment the app cannot take", () => {
    /* The app sends orders to the register unpaid. There is no card form in it,
       and telling Apple to test one is a rejection. */
    const notes = listing.slice(listing.indexOf("## Review notes"));
    expect(notes).toMatch(/NO PAYMENT IS TAKEN IN THE APP/);
    expect(privacy).not.toMatch(/card details are entered directly/i);
    expect(privacy).toMatch(/does not take payment/i);
  });

  it("never claims the app sends a text message", () => {
    /* Order-ready alerts are local notifications; there is no SMS anywhere.
       Scoped to the copy a customer or reviewer reads — the notes elsewhere in
       the file discuss the rule in order to state it. */
    const customerFacing =
      listing.slice(listing.indexOf("## Description"), listing.indexOf("## Keywords")) +
      listing.slice(listing.indexOf("## Review notes"), listing.indexOf("## Screenshots"));

    for (const [name, text] of [["listing copy", customerFacing], ["privacy", privacy]]) {
      expect(text, name).not.toMatch(/we'?ll text you/i);
      expect(text, name).not.toMatch(/\bSMS\b/i);
      expect(text, name).not.toMatch(/text message/i);
    }
  });

  it("quotes a real pickup window rather than one flat range", () => {
    const copy = listing.slice(listing.indexOf("## Description"), listing.indexOf("## Keywords"));
    expect(copy).not.toMatch(/15 to 25 minutes/);
    expect(copy).toMatch(/pickup window/i);
  });

  it("carries the support and privacy URLs review will click", () => {
    expect(listing).toMatch(/Support URL.*https:\/\//);
    expect(listing).toMatch(/Privacy Policy URL.*https:\/\//);
  });

  it("describes account deletion as something the app does, not a phone call", () => {
    /* Apple 5.1.1(v). Telling review that deletion is by calling the shop is
       the rejection this whole change exists to avoid. */
    expect(listing).toMatch(/Delete account/);
    expect(listing).not.toMatch(/deletion is by calling the restaurant/i);
    expect(privacy).toMatch(/Delete account/);
  });
});
