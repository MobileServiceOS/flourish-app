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
 *   version       package.json "version"
 *   display name  capacitor.config.ts "appName"
 *
 * The display name comes from `appName` rather than package.json because that
 * is already the canonical app name — Capacitor itself scaffolds the native
 * projects from it — whereas package.json "name" is an npm package identifier
 * ("flourish-bx-app") and would put that on the home screen.
 *
 * The BUILD number is deliberately not touched. It has to increase on every
 * upload to App Store Connect even when the version does not, so it belongs to
 * whoever is uploading:
 *   agvtool next-version -all
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

const { version } = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
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
   Version -> MARKETING_VERSION in every build configuration. */
{
  const before = readFileSync(PBXPROJ, "utf8");
  const found = (before.match(/MARKETING_VERSION = [^;]+;/g) ?? []).length;
  if (!found) {
    console.warn("  version  MARKETING_VERSION not found in the Xcode project — nothing stamped");
  } else {
    const after = before.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`);
    if (after !== before) writeFileSync(PBXPROJ, after);
    console.log(`  version  ${version} stamped onto ${found} build configuration(s)`);
  }
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
