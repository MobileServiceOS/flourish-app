#!/usr/bin/env node
/**
 * Stamp the app's identity onto the native project: version, and display name.
 *
 * `ios/` is gitignored and regenerated — `npx cap add ios` brings it back from
 * Capacitor's template — so anything typed into Xcode by hand survives exactly
 * until the next regeneration and then vanishes without a word. That has already
 * happened twice:
 *
 *   - the version drifted: package.json said 1.0.0 while Xcode said 1.0
 *   - the display name came back empty, so the home screen read "App"
 *
 * Both are the same bug, so both are fixed the same way: a single authoritative
 * value in a file that IS committed, stamped onto the generated project after
 * `cap sync` has finished with it.
 *
 * SOURCES OF TRUTH
 *   version        package.json "version"
 *   build number   package.json "flourish.ios.buildNumber"
 *   display name   capacitor.config.ts "appName"
 *   device family  package.json "flourish.ios.deviceFamily"
 *   visionOS       package.json "flourish.ios.supportsVision"
 *
 * The display name comes from `appName` rather than package.json because that
 * is already the canonical app name — Capacitor itself scaffolds the native
 * projects from it — whereas package.json "name" is an npm package identifier
 * ("flourish-bx-app") and would put that on the home screen.
 *
 * The BUILD number IS stamped, which reverses an earlier decision. The argument
 * for leaving it to whoever uploads was that it moves per upload and does not
 * belong in the repo — true, but it left the number in the one directory that
 * gets regenerated, and it drifted exactly like the others: App Store Connect
 * had build 2 while the project on disk said 1. A duplicate build number is
 * rejected on upload, so the drift is not cosmetic.
 *
 * It lives in package.json now and is bumped there before an upload.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PBXPROJ = resolve(ROOT, "ios/App/App.xcodeproj/project.pbxproj");
const INFO_PLIST = resolve(ROOT, "ios/App/App/Info.plist");

/* ---------------------------------------------------------------------------
   Read the authoritative values, and refuse to stamp a bad one. Stamping
   nothing is recoverable; stamping "" onto the home screen looks like a broken
   app and ships. */

const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const { version } = pkg;
const ios = pkg.flourish?.ios ?? {};
const deviceFamily = String(ios.deviceFamily ?? "").trim();
const buildNumber = ios.buildNumber;
const supportsVision = Boolean(ios.supportsVision);

if (!/^[12](,[12])*$/.test(deviceFamily)) {
  console.error(`\n  flourish.ios.deviceFamily "${deviceFamily}" is not a device family list — not stamping.\n`);
  process.exit(1);
}
if (!Number.isInteger(buildNumber) || buildNumber < 1) {
  console.error(`\n  flourish.ios.buildNumber "${buildNumber}" is not a positive integer — not stamping.\n`);
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`\n  package.json version "${version}" is not X.Y.Z — not stamping.\n`);
  process.exit(1);
}

const capConfig = readFileSync(resolve(ROOT, "capacitor.config.ts"), "utf8");
const appName = (/appName:\s*["'`](.+?)["'`]/.exec(capConfig) ?? [])[1]?.trim();

/* "App" is Capacitor's own target name and what an unstamped build shows. If it
   ever became the configured value the stamp would be a no-op that looked like
   a success, so it is rejected at the source. */
if (!appName || appName === "App") {
  console.error(
    `\n  capacitor.config.ts appName is ${appName ? `"${appName}"` : "missing"} — not stamping.\n` +
    "  That is the value the home screen shows under the icon.\n"
  );
  process.exit(1);
}

if (!existsSync(PBXPROJ)) {
  // Perfectly normal: the platform has not been added on this machine.
  console.log("  stamp    no iOS project to stamp (run: npx cap add ios)");
  process.exit(0);
}

/* ---------------------------------------------------------------------------
   Set a build setting in every configuration.

   Two branches, and the second is the one that matters: a project regenerated
   by `npx cap add ios` may not contain the setting at all, and a plain
   search-and-replace over an absent key silently does nothing. So a missing
   setting is ADDED, anchored to the INFOPLIST_FILE line that Capacitor's
   template does always write. */
function setBuildSetting(name, value) {
  const before = readFileSync(PBXPROJ, "utf8");
  const has = new RegExp(`${name} = [^;]*;`).test(before);
  const after = has
    ? before.replace(new RegExp(`${name} = [^;]*;`, "g"), `${name} = ${value};`)
    : before.replace(/(INFOPLIST_FILE = App\/Info\.plist;)/g,
        `$1\n\t\t\t\t${name} = ${value};`);
  if (after !== before) writeFileSync(PBXPROJ, after);
  return (after.match(new RegExp(`${name} = ${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")};`, "g")) ?? []).length;
}

/* ---------------------------------------------------------------------------
   Version -> MARKETING_VERSION in every build configuration. */
{
  /* Through the same add-if-missing path as everything else. This used to only
     replace, and warned "not found — nothing stamped" when the key was absent —
     which is precisely the regenerated-project case the stamping exists for. */
  const n = setBuildSetting("MARKETING_VERSION", version);
  console.log(`  version  ${version} stamped onto ${n} build configuration(s)`);
}

/* ---------------------------------------------------------------------------
   Display name, in BOTH places, because they are read by different things.

   CFBundleDisplayName in Info.plist is what iOS puts under the icon. Capacitor
   ships a real Info.plist, so this is the value that actually matters.

   INFOPLIST_KEY_CFBundleDisplayName is what Xcode's General tab shows in its
   "Display Name" field. It has no effect on the build while INFOPLIST_FILE is
   set, but leaving it blank is how this looked broken to a human opening Xcode
   even when the built app was correct. Keeping them equal means the two places
   someone might look agree with each other. */

const quoted = /[^A-Za-z0-9_.]/.test(appName) ? `"${appName}"` : appName;

{
  const before = readFileSync(PBXPROJ, "utf8");
  let after;
  if (/INFOPLIST_KEY_CFBundleDisplayName = [^;]*;/.test(before)) {
    after = before.replace(
      /INFOPLIST_KEY_CFBundleDisplayName = [^;]*;/g,
      `INFOPLIST_KEY_CFBundleDisplayName = ${quoted};`
    );
  } else {
    // A freshly regenerated project has no such setting; add it beside the
    // Info.plist reference that Capacitor's template does write.
    after = before.replace(
      /(INFOPLIST_FILE = App\/Info\.plist;)/g,
      `$1\n\t\t\t\tINFOPLIST_KEY_CFBundleDisplayName = ${quoted};`
    );
  }
  if (after !== before) writeFileSync(PBXPROJ, after);
}

if (!existsSync(INFO_PLIST)) {
  console.error("\n  Info.plist is missing — cannot set the display name.\n");
  process.exit(1);
}

const plist = (args) =>
  execFileSync("/usr/libexec/PlistBuddy", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

try {
  plist(["-c", `Set :CFBundleDisplayName ${appName}`, INFO_PLIST]);
} catch {
  // Not present at all in a freshly generated plist: add it.
  plist(["-c", `Add :CFBundleDisplayName string ${appName}`, INFO_PLIST]);
}

/* Read it straight back out. A stamp that silently did nothing is the failure
   this whole file exists to prevent, so it is not taken on trust. */
const readBack = plist(["-c", "Print :CFBundleDisplayName", INFO_PLIST]).trim();
if (readBack !== appName) {
  console.error(`\n  Display name did not stick: wrote "${appName}", read back "${readBack}".\n`);
  process.exit(1);
}

console.log(`  name     "${appName}" stamped onto Info.plist and the Xcode display-name setting`);

/* ---------------------------------------------------------------------------
   iPhone only.

   TARGETED_DEVICE_FAMILY "1,2" means iPhone AND iPad, and App Store Connect
   then refuses the submission until 13-inch iPad screenshots are supplied. This
   is a pickup ordering app for one restaurant in the Bronx; there is no iPad
   design and no reason to claim one.

   "1" is iPhone. "2" is iPad. */
{
  const n = setBuildSetting("TARGETED_DEVICE_FAMILY", `"${deviceFamily}"`);
  const label = deviceFamily === "1" ? "iPhone only" : `families ${deviceFamily}`;
  console.log(`  devices  ${label} stamped onto ${n} build configuration(s)`);
}

/* An iPhone-only app is still offered on Vision Pro as a "compatible" app
   unless it opts out. Opting out is a build setting; the App Store Connect
   availability checkbox is a separate, owner-side toggle. */
{
  const n = setBuildSetting("SUPPORTS_XR_DESIGNED_FOR_IPHONE_IPAD", supportsVision ? "YES" : "NO");
  console.log(`  vision   ${supportsVision ? "allowed" : "opted out"} on ${n} build configuration(s)`);
}

/* The build number has to increase on every upload; a duplicate is rejected.
   It is stamped rather than left in Xcode for the same reason as everything
   else here — the directory it lived in gets regenerated. */
{
  const n = setBuildSetting("CURRENT_PROJECT_VERSION", String(buildNumber));
  console.log(`  build    ${buildNumber} stamped onto ${n} build configuration(s)`);
}
