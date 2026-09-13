import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

/* Node 26 defines its own `localStorage` / `sessionStorage` globals, which are
   accessors that return undefined unless the process was started with
   --localstorage-file. Because vitest's jsdom environment shares one object for
   `window` and `globalThis`, those accessors shadow jsdom's real Storage and
   every test that touches storage dies on `undefined.clear()`.

   Install an in-memory Storage on both names before anything reads them. The
   app only ever needs get/set/remove/clear, and a plain Map keeps each test
   isolated in the same way jsdom's own storage would. */
function installStorage(name) {
  const existing = Object.getOwnPropertyDescriptor(globalThis, name);
  if (existing && existing.value && typeof existing.value.clear === "function") return;
  const map = new Map();
  const storage = {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => { map.set(String(k), String(v)); },
    removeItem: (k) => { map.delete(String(k)); },
    clear: () => { map.clear(); },
  };
  Object.defineProperty(globalThis, name, {
    value: storage, writable: true, configurable: true, enumerable: false,
  });
}
installStorage("localStorage");
installStorage("sessionStorage");

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

/* The launch bloom holds the app for ~2.5s the first time it runs in a session.
   Every test that is about ordering food is a "second launch" — otherwise the
   whole suite would sit through the animation. The splash's own tests clear
   this flag to get the first-launch behaviour back. */
beforeEach(() => {
  try { window.sessionStorage.setItem("flourish:splash-seen", "1"); } catch { /* ignore */ }
});

/* jsdom implements neither of these, and the menu uses both for chip scrolling
   and the scroll-spy. Stub them so a missing browser API never fails a test
   that is actually about ordering food. */
Element.prototype.scrollIntoView = vi.fn();

if (!globalThis.IntersectionObserver) {
  globalThis.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (!window.matchMedia) {
  window.matchMedia = (q) => ({
    matches: false, media: q, onchange: null,
    addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  });
}

if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}

/* ---------------------------------------------------------------------------
   A SAFETY NET FOR FAKE TIMERS.

   Twenty test files call `vi.useFakeTimers()`. Every one of them restores in
   its own cleanup today — but a file that throws, or is killed by a timeout,
   between faking and restoring leaves the timers frozen for every file that
   runs after it. And frozen timers do not fail: `waitFor` polls on real timers
   and simply never fires, so the next file's tests hang until the 20s
   `testTimeout` and report as an unexplained timeout in code that is fine.

   That is exactly the signature of docs/TECH-DEBT.md #4 — two occurrences, in
   two unrelated files, both stopping at precisely 20,000ms, both passing in
   isolation. It was also reproduced first-hand while writing
   petalsHook.test.jsx, where freezing the timers without `shouldAdvanceTime`
   made all eight tests in the file time out at 20s each.

   This does not prove #4's cause. It removes the mechanism cheaply, which is
   worth doing either way: nothing legitimately needs fake timers to survive
   the test that installed them. */
afterEach(() => {
  vi.useRealTimers();
});
