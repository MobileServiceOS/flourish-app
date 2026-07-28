import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

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
