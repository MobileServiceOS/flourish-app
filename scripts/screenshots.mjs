#!/usr/bin/env node
/**
 * App Store screenshots, from the real app running in the iOS Simulator.
 *
 *   VITE_API_BASE=https://... VITE_APP_KEY=... node scripts/screenshots.mjs
 *
 * Produces screenshots/01-menu.png … 05-confirmation.png at exactly 1290×2796
 * (iPhone 15 Pro Max, the 6.7" slot in App Store Connect) and fails if any file
 * comes out a different size. A silently mis-sized PNG is rejected on upload
 * and costs a review cycle.
 *
 * ---------------------------------------------------------------------------
 * TWO THINGS THIS HAS TO GET RIGHT
 *
 * 1. The screens must show real data. The app decides it is in preview mode
 *    from GET /health, so a build with no proxy behind it shows "ordering not
 *    available right now" on every screen. This builds against the hosted
 *    proxy, and the calls it makes to reach these screens — /health, /quote,
 *    /loyalty — are all READ-ONLY. None of them creates anything.
 *
 * 2. The confirmation screen must not cost the restaurant a real order.
 *    Reaching it normally means POST /orders, which puts a genuine open ticket
 *    on the live register and prints a genuine ticket in the kitchen that
 *    somebody then has to void.
 *
 *    So the ONE call that creates something is fixtured. A driver script is
 *    injected into the built index.html which wraps fetch and answers
 *    POST /api/clover/orders — and only that — from a fixture. The app runs its
 *    own code path the whole way, the confirmation screen renders exactly as it
 *    does in production, and nothing reaches Clover.
 *
 *    The driver is injected into `dist/` by this script, AFTER the build. It is
 *    not in the source, cannot be imported by the app, and is physically absent
 *    from anything `npm run release:ios` produces.
 *
 * ---------------------------------------------------------------------------
 * HOW THE SCREENS ARE REACHED
 *
 * simctl cannot tap. The driver therefore does the tapping from inside the web
 * view: it is told which screen to reach through a value baked into the bundle,
 * walks the UI by clicking real elements, and stops. One build per screen —
 * slower than one build and five taps, but there is no timing handshake between
 * two processes to get wrong, and a re-run lands on the same pixels.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "screenshots");
const BUNDLE_ID = "com.flourishbx.order";
const DEVICE_NAME = "Flourish Screenshots 6.7";
const DEVICE_TYPE = "com.apple.CoreSimulator.SimDeviceType.iPhone-15-Pro-Max";
const EXPECT = { width: 1290, height: 2796 };

/* Outside ios/. `npx cap sync` runs an xcodebuild clean, and Xcode refuses to
   delete a directory it did not create itself — a build output left inside
   ios/App made every later sync fail with "Could not delete ... because it was
   not created by the build system". */
const BUILD_DIR = resolve(ROOT, ".screenshot-build");

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", cwd: ROOT, stdio: "pipe", ...opts });
const log = (...a) => console.log(" ", ...a);

/* Teardown that is allowed to fail: terminating an app that is not running, or
   uninstalling one that was never installed, both exit non-zero and neither is
   a problem. */
const shOk = (cmd, args) => { try { sh(cmd, args, { stdio: "ignore" }); } catch { /* fine */ } };

/* ---------------------------------------------------------------------------
   The customer in the screenshots.

   Never a real one. These go on a public product page, and a real customer's
   name and number would be published to anyone who looks at the App Store.
   "Kay K" is the same placeholder used in the kitchen-ticket documentation. */
const FAKE = { name: "Kay K", phone: "3475550142" };   // 555 = reserved for fiction

/* ---------------------------------------------------------------------------
   The five screens. `steps` runs inside the web view, against the real DOM. */
const SCREENS = [
  {
    file: "01-menu.png",
    what: "the menu, scrolled to the top",
    steps: [],                                   // where the app already opens
  },
  {
    file: "02-item-sheet.png",
    what: "the Oxtail options sheet",
    steps: [{ do: "openItem", name: "Oxtail" }, { wait: 600 }],
  },
  {
    file: "03-cart.png",
    what: "a cart with two items",
    steps: [
      { do: "addItem", name: "Oxtail", sides: ["Rice And Peas", "Mac And Cheese"] },
      { do: "addItem", name: "Jerk Chicken", sides: ["Festival", "Steam Veg."] },
      { do: "goTab", name: "Cart" },
      { wait: 1200 },                            // let the ready window arrive
    ],
  },
  {
    file: "04-checkout.png",
    what: "checkout with details filled in",
    steps: [
      { do: "addItem", name: "Oxtail", sides: ["Rice And Peas", "Mac And Cheese"] },
      { do: "addItem", name: "Jerk Chicken", sides: ["Festival", "Steam Veg."] },
      { do: "goTab", name: "Cart" },
      { do: "clickText", text: "Go to checkout" },
      { do: "fill", label: "Name", value: FAKE.name },
      { do: "fill", label: "Phone number", value: FAKE.phone },
      { do: "blur" },
      { wait: 1200 },
      // The PAY AT PICKUP panel is the thing that answers "how do I pay?"
      // before anyone has to ask, so it belongs in frame.
      { do: "scrollBy", y: 520 },
    ],
  },
  {
    file: "05-confirmation.png",
    what: "the order confirmation and live status",
    steps: [
      { do: "addItem", name: "Oxtail", sides: ["Rice And Peas", "Mac And Cheese"] },
      { do: "addItem", name: "Jerk Chicken", sides: ["Festival", "Steam Veg."] },
      { do: "goTab", name: "Cart" },
      { do: "clickText", text: "Go to checkout" },
      { do: "fill", label: "Name", value: FAKE.name },
      { do: "fill", label: "Phone number", value: FAKE.phone },
      { do: "blur" },
      { wait: 1500 },
      { do: "clickText", text: "Place order" },   // fixtured — see driver below
      { wait: 2500 },
    ],
  },
];

/* ---------------------------------------------------------------------------
   The driver. Runs in the web view before the app boots.

   Two jobs: fixture the one call that would create something, and walk the UI
   to the screen being captured. */
function driverSource(screen) {
  const fixture = {
    success: true,
    /* Shown on the confirmation screen as "Register #…". A literal
       "SCREENSHOT-ORDER" reads as debug text on a public product page, so this
       is shaped like the Clover order id it stands in for. */
    orderId: "K7QM4RXZ9T2WB",
    orderNumber: null,          // the app mints its own and passes it in
    total: null,
    paid: false,
    printed: true,
    printError: null,
    printer: { uuid: "ZVZ9PRJ255V90", name: "Station Printer", type: "MY_LOCAL" },
    messaged: false,
    attached: true,
  };

  return `
(() => {
  var STEPS = ${JSON.stringify(screen.steps)};
  var FIXTURE = ${JSON.stringify(fixture)};

  /* ---- 1. never create a real order ----------------------------------- */
  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = String(typeof input === "string" ? input : (input && input.url) || "");
    var method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();

    // POST /orders is the ONLY call that puts something on the live register.
    if (method === "POST" && /\\/api\\/clover\\/orders$/.test(url)) {
      var body = {};
      try { body = JSON.parse((init && init.body) || "{}"); } catch (e) {}
      var quoted = window.__lastQuote || {};
      var payload = Object.assign({}, FIXTURE, {
        orderNumber: body.orderNumber || null,
        pickupLabel: quoted.label || null,
        readyWindow: quoted.startISO
          ? { startISO: quoted.startISO, endISO: quoted.endISO, label: quoted.label }
          : null,
        prepMinutes: quoted.prepMinutes || null,
      });
      console.log("[screenshots] POST /orders intercepted — nothing sent to Clover");
      return Promise.resolve(new Response(JSON.stringify(payload), {
        status: 200, headers: { "Content-Type": "application/json" },
      }));
    }

    // The order's live status would 404 for an id Clover has never seen.
    if (/\\/api\\/clover\\/orders\\/[^/]+\\/status$/.test(url)) {
      return Promise.resolve(new Response(JSON.stringify({
        id: "K7QM4RXZ9T2WB", paid: false, voided: false, refunded: false,
        paymentState: "OPEN", state: "open", total: 0, amountPaid: 0,
        printed: true, manualReady: false, settled: false,
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (/\\/api\\/clover\\/orders\\/[^/]+$/.test(url) && method === "GET") {
      return Promise.resolve(new Response(JSON.stringify({
        id: "K7QM4RXZ9T2WB", state: "open", total: 0, printed: true,
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    /* Everything else is the real hosted proxy. /health, /quote and /loyalty
       are read-only; they show real prices and a real pickup window. */
    var p = realFetch(input, init);
    if (/\\/api\\/clover\\/quote$/.test(url)) {
      p.then(function (r) {
        r.clone().json().then(function (q) { window.__lastQuote = q; }).catch(function () {});
      }).catch(function () {});
    }
    return p;
  };

  /* ---- 2. walk the UI --------------------------------------------------- */
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  function buttons() { return Array.prototype.slice.call(document.querySelectorAll("button")); }
  function byText(re) { return buttons().filter(function (b) { return re.test((b.textContent || "").trim()); })[0]; }

  function setValue(el, value) {
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function openItem(name) {
    var re = new RegExp("^Choose options for " + name + "$");
    var btn = buttons().filter(function (b) { return re.test(b.getAttribute("aria-label") || ""); })[0];
    if (!btn) throw new Error("no options button for " + name);
    btn.click();
    await sleep(700);
  }

  function pickOption(groupLabel, optionText) {
    // Group renders a label div followed by its .opt rows, inside one wrapper.
    var groups = Array.prototype.slice.call(document.querySelectorAll(".sheet-body > div"));
    var group = groups.filter(function (g) {
      var first = g.firstElementChild;
      return first && (first.textContent || "").trim() === groupLabel;
    })[0];
    if (!group) return false;
    var opt = Array.prototype.slice.call(group.querySelectorAll(".opt")).filter(function (o) {
      return (o.textContent || "").indexOf(optionText) === 0;
    })[0];
    if (!opt) return false;
    opt.click();
    return true;
  }

  async function addItem(name, sides) {
    await openItem(name);
    if (sides && sides.length) {
      pickOption("Side 1", sides[0]);
      await sleep(200);
      pickOption("Side 2", sides[1]);
      await sleep(200);
    }
    var add = byText(/^Add\\b/);
    if (!add) throw new Error("no Add button in the sheet for " + name);
    add.click();
    await sleep(600);
  }

  async function run() {
    // Let the splash finish and the first render settle.
    await sleep(3200);
    for (var i = 0; i < STEPS.length; i++) {
      var s = STEPS[i];
      if (s.wait) { await sleep(s.wait); continue; }
      if (s.do === "openItem") { await openItem(s.name); continue; }
      if (s.do === "addItem") { await addItem(s.name, s.sides); continue; }
      if (s.do === "goTab") {
        var tab = Array.prototype.slice.call(document.querySelectorAll(".tabbar button"))
          .filter(function (b) { return new RegExp(s.name, "i").test(b.textContent || ""); })[0];
        if (!tab) throw new Error("no tab " + s.name);
        tab.click();
        await sleep(700);
        continue;
      }
      if (s.do === "clickText") {
        var b = byText(new RegExp(s.text, "i"));
        if (!b) throw new Error("no button matching " + s.text);
        b.click();
        await sleep(900);
        continue;
      }
      if (s.do === "fill") {
        var input = document.querySelector('input[aria-label="' + s.label + '"]');
        if (!input) throw new Error("no field " + s.label);
        setValue(input, s.value);
        await sleep(250);
        continue;
      }
      if (s.do === "scrollBy") {
        window.scrollBy({ top: s.y, behavior: "instant" });
        await sleep(500);
        continue;
      }
      if (s.do === "blur") {
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        // Nothing should be focused: a caret or a keyboard in a screenshot
        // looks like a half-finished form.
        await sleep(400);
        continue;
      }
    }
    document.documentElement.setAttribute("data-shot-ready", "1");
    console.log("[screenshots] ready");
  }

  if (document.readyState === "complete") run();
  else window.addEventListener("load", run);
})();
`;
}

/* --------------------------------------------------------------------------- */
function requireEnv() {
  const base = (process.env.VITE_API_BASE || "").trim();
  const key = (process.env.VITE_APP_KEY || "").trim();
  const problems = [];
  if (!base) problems.push("VITE_API_BASE is not set — every screen would read 'ordering not available'.");
  else if (!/^https:\/\//.test(base)) problems.push(`VITE_API_BASE must be https (got ${base}).`);
  if (!key) problems.push("VITE_APP_KEY is not set — /quote returns 401 and the pickup window never arrives.");
  if (problems.length) {
    console.error("\n  Cannot take screenshots:\n");
    for (const p of problems) console.error(`  - ${p}`);
    console.error("");
    process.exit(1);
  }
  return { base, key };
}

function simulator() {
  const list = JSON.parse(sh("xcrun", ["simctl", "list", "devices", "--json"]));
  for (const [runtime, devices] of Object.entries(list.devices)) {
    const hit = devices.find((d) => d.name === DEVICE_NAME && d.isAvailable !== false);
    if (hit) return { udid: hit.udid, runtime };
  }
  // The stock device set may have no 6.7" phone at all — newer Xcodes ship a
  // 6.9" Pro Max, which captures 1320×2868 and is the wrong size for this slot.
  const runtimes = JSON.parse(sh("xcrun", ["simctl", "list", "runtimes", "--json"]))
    .runtimes.filter((r) => r.isAvailable && r.identifier.includes("iOS"));
  if (!runtimes.length) throw new Error("no iOS simulator runtime installed");
  const runtime = runtimes[runtimes.length - 1].identifier;
  const udid = sh("xcrun", ["simctl", "create", DEVICE_NAME, DEVICE_TYPE, runtime]).trim();
  log(`created simulator ${DEVICE_NAME}`);
  return { udid, runtime };
}

const booted = (udid) => {
  const list = JSON.parse(sh("xcrun", ["simctl", "list", "devices", "--json"]));
  return Object.values(list.devices).flat().some((d) => d.udid === udid && d.state === "Booted");
};

function buildApp(env) {
  sh("npx", ["vite", "build"], { env: { ...process.env, ...env }, stdio: "ignore" });
}

function injectDriver(screen) {
  const index = resolve(ROOT, "dist/index.html");
  const html = readFileSync(index, "utf8");
  const tag = `<script>${driverSource(screen)}</script>`;
  writeFileSync(index, html.replace("</body>", `${tag}\n</body>`));
}

function pngSize(path) {
  const head = readFileSync(path).subarray(0, 33);
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

function appPath() {
  const base = join(BUILD_DIR, "Release-iphonesimulator");
  if (!existsSync(base)) return null;
  const app = readdirSync(base).find((f) => f.endsWith(".app"));
  return app ? join(base, app) : null;
}

/* --------------------------------------------------------------------------- */
async function main() {
  const { base, key } = requireEnv();
  mkdirSync(OUT, { recursive: true });

  log(`proxy   ${base}`);
  log(`app key set (${key.length} chars)`);

  const { udid } = simulator();
  log(`device  ${udid}`);
  if (!booted(udid)) {
    sh("xcrun", ["simctl", "boot", udid]);
    log("booting…");
    await new Promise((r) => setTimeout(r, 25_000));
  }
  // A status bar with a real clock and a half-full battery dates a screenshot.
  try {
    sh("xcrun", ["simctl", "status_bar", udid, "override",
      "--time", "9:41", "--batteryState", "charged", "--batteryLevel", "100",
      "--cellularMode", "active", "--cellularBars", "4", "--wifiBars", "3"]);
  } catch { /* older simulators do not support every flag */ }

  /* Build the .app ONCE. Only the web payload differs between screens, and a
     full xcodebuild per screen is both slow and a way to trip over Xcode's
     build database lock when a run is interrupted. After this, each screen is
     a vite build copied straight into the bundle. */
  log("");
  log("building the app once…");
  buildApp({ VITE_API_BASE: base, VITE_APP_KEY: key });
  sh("npx", ["cap", "sync", "ios"], { stdio: "ignore" });
  sh("xcodebuild", [
    "-workspace", "ios/App/App.xcworkspace",
    "-scheme", "App",
    "-configuration", "Release",
    "-sdk", "iphonesimulator",
    "-derivedDataPath", join(BUILD_DIR, "dd"),
    "CONFIGURATION_BUILD_DIR=" + join(BUILD_DIR, "Release-iphonesimulator"),
    "CODE_SIGNING_ALLOWED=NO",
    "build",
  ], { stdio: "ignore" });

  const app = appPath();
  if (!app) throw new Error("the build produced no .app");
  log(`built   ${app.replace(ROOT + "/", "")}`);

  const results = [];
  for (const screen of SCREENS) {
    log("");
    log(`— ${screen.file}: ${screen.what}`);

    buildApp({ VITE_API_BASE: base, VITE_APP_KEY: key });
    injectDriver(screen);

    /* Swap the web payload inside the built bundle. The native binary has not
       changed, so there is nothing to compile. */
    const web = join(app, "public");
    sh("rm", ["-rf", web]);
    sh("cp", ["-R", resolve(ROOT, "dist"), web]);

    shOk("xcrun", ["simctl", "terminate", udid, BUNDLE_ID]);
    shOk("xcrun", ["simctl", "uninstall", udid, BUNDLE_ID]);
    sh("xcrun", ["simctl", "install", udid, app]);
    sh("xcrun", ["simctl", "launch", udid, BUNDLE_ID], { stdio: "ignore" });

    // The driver waits out the splash, then walks the UI.
    const settle = 7000 + screen.steps.reduce((t, s) => t + (s.wait || 1000), 0);
    await new Promise((r) => setTimeout(r, settle));

    const out = join(OUT, screen.file);
    sh("xcrun", ["simctl", "io", udid, "screenshot", "--type", "png", out]);

    const size = pngSize(out);
    const ok = size.width === EXPECT.width && size.height === EXPECT.height;
    results.push({ file: screen.file, ...size, ok });
    log(`  ${size.width}×${size.height} ${ok ? "OK" : "WRONG SIZE"}`);
  }

  console.log("");
  const bad = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`  screenshots/${r.file}  ${r.width}×${r.height}  ${r.ok ? "OK" : "REJECTED SIZE"}`);
  }
  console.log("");
  if (bad.length) {
    console.error(`  ${bad.length} screenshot(s) are not ${EXPECT.width}×${EXPECT.height}. ` +
      "App Store Connect refuses these on upload.\n");
    process.exit(1);
  }
  log(`all ${results.length} at ${EXPECT.width}×${EXPECT.height}`);
  log("no order was created in Clover: POST /orders is fixtured in the driver.");
  console.log("");
}

main().catch((e) => {
  console.error(`\n  screenshots failed: ${e.message}\n`);
  if (e.stdout) console.error(String(e.stdout).slice(-2000));
  if (e.stderr) console.error(String(e.stderr).slice(-2000));
  process.exit(1);
});
