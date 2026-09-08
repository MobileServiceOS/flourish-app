#!/usr/bin/env node
/**
 * Stamp the version from package.json onto the native project.
 *
 * `package.json` is the single source of truth for the app's version. The Xcode
 * project is generated — `ios/` is gitignored and comes back from
 * `npx cap add ios` — so anything typed into Xcode by hand is lost the next time
 * the platform is regenerated, and the two numbers drift apart silently. They
 * had already: package.json said 1.0.0 while Xcode said 1.0, which Apple accepts
 * but which reads as two different releases in two places.
 *
 * Run as part of `npm run sync`, after `cap sync` has done its work.
 *
 * The BUILD number is not touched. It has to increase on every upload to App
 * Store Connect even when the version does not, so it belongs to whoever is
 * uploading, not to this file. Bump it in Xcode, or with:
 *   agvtool next-version -all
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PBXPROJ = resolve(ROOT, "ios/App/App.xcodeproj/project.pbxproj");

const { version } = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`\n  package.json version "${version}" is not X.Y.Z — not stamping.\n`);
  process.exit(1);
}

if (!existsSync(PBXPROJ)) {
  // Perfectly normal: the platform has not been added on this machine.
  console.log("  version  no iOS project to stamp (run: npx cap add ios)");
  process.exit(0);
}

const before = readFileSync(PBXPROJ, "utf8");
const after = before.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`);

const count = (before.match(/MARKETING_VERSION = [^;]+;/g) ?? []).length;
if (!count) {
  console.warn("  version  MARKETING_VERSION not found in the Xcode project — nothing stamped");
  process.exit(0);
}

if (after !== before) writeFileSync(PBXPROJ, after);
console.log(`  version  ${version} stamped onto ${count} Xcode build configuration(s)`);
