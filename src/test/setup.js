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
