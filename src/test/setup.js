import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
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

if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}
