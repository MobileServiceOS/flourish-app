/**
 * What this bundle is, so "is the app stale?" is answerable from inside it.
 *
 * Vite replaces `__BUILD__` at build time from package.json plus a timestamp —
 * see vite.config.js. The timestamp is the part that earns its keep: a version
 * number tells you which release was intended, and a date tells you whether the
 * bundle on the phone predates the change you are looking for. A device build
 * cut seven hours before a merge behaved exactly as its own code said, and the
 * report read as a broken feature.
 *
 * Falls back rather than throwing. A test runner or a bare `vite dev` may not
 * define it, and the app must render either way.
 */
const stamp = (() => {
  try {
    // eslint-disable-next-line no-undef
    return typeof __BUILD__ === "object" && __BUILD__ ? __BUILD__ : null;
  } catch {
    return null;
  }
})();

export const BUILD = {
  version: stamp?.version ?? "dev",
  build: stamp?.build ?? "",
  at: stamp?.at ?? null,
};

/** "1.1.0 (5) · 13 Sep" — short enough for a footer, specific enough to act on. */
export function buildLabel(b = BUILD) {
  const v = b.build ? `${b.version} (${b.build})` : b.version;
  if (!b.at) return v;
  const d = new Date(b.at);
  if (Number.isNaN(d.getTime())) return v;
  return `${v} · ${d.toLocaleDateString("en-US", { day: "numeric", month: "short" })}`;
}

/** The full stamp, for a staff sheet or a bug report. */
export const buildDetail = (b = BUILD) =>
  `${b.version}${b.build ? ` build ${b.build}` : ""}${b.at ? ` · built ${b.at}` : ""}`;
