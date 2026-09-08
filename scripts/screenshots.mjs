#!/usr/bin/env node
/**
 * App Store screenshots, from the real app running in the iOS Simulator.
 *
 *   VITE_API_BASE=https://... VITE_APP_KEY=... node scripts/screenshots.mjs
 *   ... node scripts/screenshots.mjs 6.5        # just one slot
 *
 * Produces both sizes App Store Connect asks for, five screens each:
 *
 *   screenshots/6.9/01-menu.png … 05-confirmation.png   1290×2796
 *   screenshots/6.5/01-menu.png … 05-confirmation.png   1284×2778
 *
 * Each is captured NATIVELY on a device whose screen is that size, and the
 * dimensions are read back out of the PNG header afterwards — the run fails on
 * any mismatch. A file six pixels off is refused on upload, and nothing tells
 * you until the day you meant to submit.
 *
 * Nothing is ever rescaled to fit a slot. Resampling a 1290-wide capture down
 * to 1284 leaves text visibly soft, and reviewers look at hundreds of these.
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
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "screenshots");
const BUNDLE_ID = "com.flourishbx.order";
/* ---------------------------------------------------------------------------
   THE SIZE SETS

   App Store Connect has two iPhone slots and refuses a file that is not one of
   the exact sizes its slot accepts. Filling only one is how an upload gets
   rejected on the day you meant to submit, so both are generated.

   Every size is captured NATIVELY on a device whose screen is that size.
   Rescaling a 1290-wide PNG down to 1284 is six pixels of difference and it
   still looks wrong: text renders soft, and reviewers see hundreds of these.

   Which device produces which size was measured, not read off a spec sheet —
   iPhone 12 Pro Max, 13 Pro Max and 14 Plus all capture 1284×2778. */
const SIZE_SETS = [
  {
    slot: "6.9",
    dir: "6.9",
    width: 1290,
    height: 2796,
    deviceName: "Flourish Screenshots 6.9",
    deviceType: "com.apple.CoreSimulator.SimDeviceType.iPhone-15-Pro-Max",
    // The slot App Store Connect labels "6.9-inch" accepts 1320×2868 or
    // 1290×2796; the 15 Pro Max is the phone that captures the latter.
    note: "iPhone 15 Pro Max",
  },
  {
    slot: "6.5",
    dir: "6.5",
    width: 1284,
    height: 2778,
    deviceName: "Flourish Screenshots 6.5",
    deviceType: "com.apple.CoreSimulator.SimDeviceType.iPhone-13-Pro-Max",
    // 1242×2688 also fills this slot; 1284×2778 is the larger of the two and
    // the one an iPhone 13 Pro Max produces.
    note: "iPhone 13 Pro Max",
  },
];

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

/**
 * Prove the credentials work before spending ten minutes on a build.
 *
 * The failure this exists to catch is quiet and expensive. `/health` needs no
 * app key, so a run with a WRONG key still reports the app as online and the
 * menu and item sheet still look perfect — while `/quote` 401s, the cart and
 * checkout never get a pickup window, the disabled "Place order" button strands
 * the driver, and the confirmation screen never happens. You find out at the
 * end, from screenshots that are subtly wrong rather than obviously broken.
 *
 * A placeholder pasted in place of the real key does exactly this. So the key
 * is used against a real authenticated endpoint here, first, and a bad one
 * stops the run in seconds.
 */
async function preflight({ base, key }) {
  const fail = (lines) => {
    console.error("\n  Cannot take screenshots:\n");
    for (const l of lines) console.error(`  ${l}`);
    console.error("");
    process.exit(1);
  };

  let health;
  try {
    const r = await fetch(`${base}/api/clover/health`, { signal: AbortSignal.timeout(20_000) });
    health = await r.json();
  } catch (e) {
    fail([
      `- The proxy at ${base} did not answer (${e.message}).`,
      "  Screens would all read 'ordering not available'. Check the deploy is up.",
    ]);
  }
  if (!health?.configured) {
    fail([
      `- ${base} is up but reports configured:false (${health?.reason ?? "no reason given"}).`,
      "  Its Clover credentials are wrong, so no menu data would load.",
    ]);
  }

  /* The real test: an endpoint that actually requires the key. */
  const r = await fetch(`${base}/api/clover/quote`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-flourish-key": key },
    body: JSON.stringify({ cart: [{ itemId: "60KCQ1V22Q98M", qty: 1 }] }),
    signal: AbortSignal.timeout(20_000),
  });

  if (r.status === 401) {
    fail([
      `- The app key is wrong: /quote answered 401. (${key.length} characters were sent.)`,
      "",
      "  Screens 1 and 2 would still look right, because /health needs no key —",
      "  and screens 3 to 5 would be silently broken. That is why this stops here.",
      "",
      "  If your shell shows something like VITE_APP_KEY=abc123...yourkey, the",
      "  placeholder was never replaced. Take the value from Railway:",
      "    Railway -> the service -> Variables -> APP_KEY",
      "",
      "  Then, so it is never pasted by hand again:",
      "    echo 'VITE_APP_KEY=<the key>' >> .env.production.local",
      "    echo 'VITE_API_BASE=" + base + "' >> .env.production.local",
    ]);
  }
  if (!r.ok) {
    fail([`- /quote answered ${r.status}. Expected 200 with a pickup window.`]);
  }

  const quote = await r.json();
  log(`preflight OK — proxy answered, key accepted, window "${quote.label}"`);
}

/* ---------------------------------------------------------------------------
   IS THE APP ACTUALLY ON SCREEN?

   `simctl launch` returns as soon as the app is asked to start, not when it has
   painted. On a cold simulator a Release build can take fifteen seconds to get
   from launch to first frame — and a capture taken before that is a perfectly
   valid PNG, at exactly the right dimensions, of the iOS home screen.

   That is the failure this guards: checking the size proves the file is
   uploadable, not that it shows the app. Three of ten screenshots passed the
   dimension check while showing a wallpaper.

   The test is colour. The app is paper-white (#FBF7FC) with restrained accents
   and reads at a mean HSV saturation under 20; the simulator's default
   wallpaper is a saturated blue and teal and reads over 100. Measured, not
   guessed — the gap is wide enough that the threshold does not have to be
   delicate. */
const APP_MAX_SATURATION = 60;

/* And "the app is up" is not the same as "the screen is ready".

   The launch screen is the app: paper-white, low saturation, and it sails
   through a colour test while showing nothing but a logo. Waiting on
   saturation alone captured the splash twice — two byte-identical files where
   the menu and the item sheet should have been.

   So readiness needs a second signal, and the one that separates them cleanly
   is how much is on screen. Measured across a 64×139 downsample: the splash
   has ~104 distinct colours, every real screen has over a thousand. A blank or
   half-painted frame fails this for the same reason the splash does. */
const APP_MIN_COLOURS = 400;

/** Saturation and colour count in one pass, so a check costs one subprocess. */
function imageStats(png) {
  const out = sh("python3", ["-c", [
    "import sys",
    "from PIL import Image",
    "im = Image.open(sys.argv[1]).convert('RGB').resize((64, 139))",
    "hsv = im.convert('HSV')",
    "px = list(hsv.getdata())",
    "sat = sum(p[1] for p in px) / len(px)",
    "print(f'{sat} {len(set(im.getdata()))}')",
  ].join("\n"), png], { stdio: ["ignore", "pipe", "ignore"] });
  const [sat, colours] = out.trim().split(/\s+/).map(Number);
  return { sat, colours };
}

/** Why this frame is not usable, or null if it is. */
function frameProblem(png) {
  const { sat, colours } = imageStats(png);
  if (sat >= APP_MAX_SATURATION) {
    return `NOT THE APP — saturation ${sat.toFixed(0)}, this is the home screen`;
  }
  if (colours < APP_MIN_COLOURS) {
    return `NOT READY — only ${colours} colours, this is the launch screen`;
  }
  return null;
}

/**
 * Block until the screen is actually showing content.
 *
 * `simctl launch` returns when the app is asked to start, not when it has
 * painted, and the splash then holds for about 2.5 seconds after that. A fixed
 * sleep has to cover both on a cold device, and when it does not the result is
 * a perfectly valid PNG, at exactly the right dimensions, of the wrong thing.
 */
async function waitForApp(udid, { timeoutMs = 60_000 } = {}) {
  const probe = join(BUILD_DIR, `probe-${udid}.png`);
  const deadline = Date.now() + timeoutMs;
  let last = "no frame captured";
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      sh("xcrun", ["simctl", "io", udid, "screenshot", "--type", "png", probe],
         { stdio: "ignore" });
      last = frameProblem(probe);
      if (!last) { rmSync(probe, { force: true }); return; }
    } catch { /* the device can refuse a capture mid-launch; try again */ }
  }
  rmSync(probe, { force: true });
  throw new Error(`the app never finished painting on ${udid} within ` +
    `${timeoutMs / 1000}s (last frame: ${last})`);
}

function simulator(set) {
  const list = JSON.parse(sh("xcrun", ["simctl", "list", "devices", "--json"]));
  for (const devices of Object.values(list.devices)) {
    const hit = devices.find((d) => d.name === set.deviceName && d.isAvailable !== false);
    if (hit) return hit.udid;
  }
  /* The device may simply not be installed. Recent Xcodes ship a 6.9" Pro Max
     and nothing older, so the phone that captures this size has to be created —
     which is cheap, and better than silently capturing the wrong dimensions on
     whatever happens to be there. */
  const runtimes = JSON.parse(sh("xcrun", ["simctl", "list", "runtimes", "--json"]))
    .runtimes.filter((r) => r.isAvailable && r.identifier.includes("iOS"));
  if (!runtimes.length) throw new Error("no iOS simulator runtime installed");
  const runtime = runtimes[runtimes.length - 1].identifier;
  const udid = sh("xcrun", ["simctl", "create", set.deviceName, set.deviceType, runtime]).trim();
  log(`created ${set.deviceName} (${set.note})`);
  return udid;
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
  await preflight({ base, key });

  /* `node scripts/screenshots.mjs 6.5` does one set; no argument does both. */
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const sets = wanted.length
    ? SIZE_SETS.filter((s) => wanted.includes(s.slot))
    : SIZE_SETS;
  if (!sets.length) {
    console.error(`\n  Unknown size set. Available: ${SIZE_SETS.map((s) => s.slot).join(", ")}\n`);
    process.exit(1);
  }

  log(`proxy   ${base}`);
  log(`app key set (${key.length} chars)`);
  log(`sets    ${sets.map((s) => `${s.slot}" ${s.width}×${s.height}`).join("   ")}`);

  /* Boot every device up front. The web payload is what changes per screen, so
     a screen is built once and captured on each device — which also guarantees
     the two sets show identical content rather than two separate runs that
     drifted apart on a price or a clock. */
  const devices = [];
  for (const set of sets) {
    const udid = simulator(set);
    if (!booted(udid)) {
      sh("xcrun", ["simctl", "boot", udid]);
      log(`booting ${set.deviceName}…`);
      await new Promise((r) => setTimeout(r, 25_000));
    }
    // A real clock and a half-full battery date a screenshot.
    try {
      sh("xcrun", ["simctl", "status_bar", udid, "override",
        "--time", "9:41", "--batteryState", "charged", "--batteryLevel", "100",
        "--cellularMode", "active", "--cellularBars", "4", "--wifiBars", "3"]);
    } catch { /* older simulators lack some flags */ }
    mkdirSync(join(OUT, set.dir), { recursive: true });
    devices.push({ set, udid });
    log(`device  ${set.slot}"  ${udid}  (${set.note})`);
  }

  /* One native build. Only the web payload differs between screens, and a full
     xcodebuild per screen is slow and trips over Xcode's build database lock
     when a run is interrupted. */
  log("");
  log("building the app once…");
  buildApp({ VITE_API_BASE: base, VITE_APP_KEY: key });
  sh("npx", ["cap", "sync", "ios"], { stdio: "ignore" });

  /* Start from a clean derived-data directory.

     An interrupted run leaves Xcode's build database locked, and every later
     build then dies with "unable to attach DB: database is locked. Possibly
     there are two concurrent builds running in the same filesystem location."
     — which reads like a concurrency bug and is really just a stale lock file.
     Throwing the directory away costs one cold build and removes the whole
     class of failure. */
  rmSync(join(BUILD_DIR, "dd"), { recursive: true, force: true });

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

    // Swap the web payload inside the built bundle; the binary is unchanged.
    const web = join(app, "public");
    sh("rm", ["-rf", web]);
    sh("cp", ["-R", resolve(ROOT, "dist"), web]);

    for (const { set, udid } of devices) {
      shOk("xcrun", ["simctl", "terminate", udid, BUNDLE_ID]);
      shOk("xcrun", ["simctl", "uninstall", udid, BUNDLE_ID]);
      sh("xcrun", ["simctl", "install", udid, app]);
      sh("xcrun", ["simctl", "launch", udid, BUNDLE_ID], { stdio: "ignore" });

      /* Two separate waits, because they are two separate things and rolling
         them into one fixed sleep is what produced screenshots of the home
         screen. First: the app has to be on screen at all, which on a cold
         device takes as long as it takes. Only then does the driver's own work
         start, and only that part is predictable. */
      await waitForApp(udid);
      const settle = 1500 + screen.steps.reduce((t, st) => t + (st.wait || 1000), 0);
      await new Promise((r) => setTimeout(r, settle));

      const rel = join(set.dir, screen.file);
      const out = join(OUT, rel);
      sh("xcrun", ["simctl", "io", udid, "screenshot", "--type", "png", out]);

      /* Read the size back out of the PNG header. Trusting the device to have
         produced its own native size is what cost a submission round: the
         wrong simulator captures a plausible-looking file at the wrong
         dimensions and nothing says so until App Store Connect refuses it. */
      /* Both checks, because either alone lets a bad file through: the wrong
         size is refused on upload, and the right size showing a wallpaper is
         accepted and then seen by everyone. */
      const size = pngSize(out);
      const sizeOk = size.width === set.width && size.height === set.height;
      const problem = frameProblem(out);
      const ok = sizeOk && !problem;

      const why = !sizeOk ? `WRONG SIZE — wanted ${set.width}×${set.height}`
        : problem ?? "OK";
      results.push({ rel, ...size, want: `${set.width}×${set.height}`, ok, why });
      log(`  ${set.slot}"  ${size.width}×${size.height}  ${why}`);
    }
  }

  console.log("");
  for (const r of results) {
    console.log(`  screenshots/${r.rel}  ${r.width}×${r.height}  ${r.why}`);
  }
  console.log("");

  const bad = results.filter((r) => !r.ok);
  if (bad.length) {
    console.error(`  ${bad.length} of ${results.length} screenshot(s) are unusable.\n`);
    for (const r of bad) console.error(`    screenshots/${r.rel}: ${r.why}`);
    console.error("");
    process.exit(1);
  }

  for (const set of sets) {
    log(`${set.slot}" slot: ${SCREENS.length} files at ${set.width}×${set.height}  (${set.note})`);
  }
  log("captured natively at each size — nothing was rescaled.");
  log("no order was created in Clover: POST /orders is fixtured in the driver.");
  console.log("");
}

main().catch((e) => {
  console.error(`\n  screenshots failed: ${e.message}\n`);
  if (e.stdout) console.error(String(e.stdout).slice(-2000));
  if (e.stderr) console.error(String(e.stderr).slice(-2000));
  process.exit(1);
});
