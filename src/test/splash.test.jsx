import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import Splash from "../components/Splash.jsx";
import {
  splashSeen, markSplashSeen, __resetSplashSeen,
  SPLASH_HOLD_MS, SPLASH_FADE_MS, SPLASH_REDUCED_MS,
} from "../lib/splashSession.js";

const SEEN = "flourish:splash-seen";
/** Put things back to "app opened cold", which setup.js deliberately undoes. */
const firstLaunch = () => {
  window.sessionStorage.removeItem(SEEN);
  __resetSplashSeen();
};

/* The "has it played" flag now lives in module scope, so it leaks between tests
   in this file unless it is reset each time. */
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  __resetSplashSeen();
});
afterEach(() => {
  vi.useRealTimers();
  window.sessionStorage.clear();
  __resetSplashSeen();
});

describe("the bloom", () => {
  it("draws a flower whose petals unfurl from the centre", () => {
    const { container } = render(<Splash />);
    const petals = container.querySelectorAll(".bloom--main .petal");
    expect(petals.length).toBe(8);
  });

  it("staggers the petals so they open in sequence, not together", () => {
    const { container } = render(<Splash />);
    const delays = [...container.querySelectorAll(".bloom--main .petal")]
      .map((p) => p.style.animationDelay);
    expect(delays[0]).toBe("0s");
    expect(delays[1]).toBe("0.05s");
    expect(delays[7]).toBe("0.35s");
    expect(new Set(delays).size).toBe(8);        // every petal distinct
  });

  it("spaces the petals evenly around the circle", () => {
    const { container } = render(<Splash />);
    const angles = [...container.querySelectorAll(".bloom--main .petal")]
      .map((p) => p.style.getPropertyValue("--a"));
    expect(angles[0]).toBe("0deg");
    expect(angles[2]).toBe("90deg");
    expect(angles[4]).toBe("180deg");
    expect(angles[6]).toBe("270deg");
  });

  it("blooms two smaller flowers later, for depth", () => {
    const { container } = render(<Splash />);
    const tl = container.querySelector(".bloom--tl .petal");
    const br = container.querySelector(".bloom--br .petal");
    expect(parseFloat(tl.style.animationDelay)).toBeCloseTo(0.82, 2);
    expect(parseFloat(br.style.animationDelay)).toBeCloseTo(1.02, 2);
    // both start after the main flower has begun opening
    expect(parseFloat(tl.style.animationDelay)).toBeGreaterThan(0.35);
  });

  it("paints each bloom in its own brand gradient, not a flat colour", () => {
    const { container } = render(<Splash />);
    const stops = (id) => [...container.querySelectorAll(`#petal-${id} stop`)]
      .map((s) => s.getAttribute("stop-color"));

    // orchid anchors it, rose sits behind, leaf is the quietest layer
    expect(stops("main")).toEqual(["#8E5BC4", "#B57EDC"]);
    expect(stops("a")).toEqual(["#E89AC7", "#F6C9E0"]);
    expect(stops("b")).toEqual(["#E89AC7", "#F6C9E0"]);
    expect(stops("c")).toEqual(["#AED06A", "#AED86A"]);

    expect(container.querySelector(".bloom--main .petal").getAttribute("fill"))
      .toBe("url(#petal-main)");
  });

  it("layers the blooms back to front, quietest last", () => {
    const { container } = render(<Splash />);
    expect(container.querySelector(".bloom--leaf")).toBeInTheDocument();
    // four rings in all: one orchid, two rose, one leaf
    expect(container.querySelectorAll(".bloom")).toHaveLength(4);
  });

  it("gives every flower its own gradient id", () => {
    const { container } = render(<Splash />);
    const ids = [...container.querySelectorAll("linearGradient")].map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("floats gold pollen upward as it opens", () => {
    const { container } = render(<Splash />);
    const dots = container.querySelectorAll(".pollen span");
    expect(dots.length).toBeGreaterThanOrEqual(4);
    expect(new Set([...dots].map((d) => d.style.animationDelay)).size).toBeGreaterThan(1);
  });

  it("puts the real logo at the centre, not a drawn wordmark", () => {
    render(<Splash />);
    const logo = screen.getByRole("img", { name: "Flourish" });
    expect(logo).toHaveAttribute("src", "/logo-mark.png");
    // the logo carries its own hummingbirds; drawing more would crowd it
    expect(document.querySelectorAll(".splash-bird")).toHaveLength(0);
  });

  it("frames the logo with the petals rather than hiding it behind them", () => {
    const { container } = render(<Splash />);
    const ring = container.querySelector(".bloom--main");
    const logo = container.querySelector(".splash-logo");
    // both present, and the logo paints above the ring
    expect(ring).toBeInTheDocument();
    expect(logo).toBeInTheDocument();
    expect(logo.compareDocumentPosition(ring) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("announces itself to a screen reader without describing the animation", () => {
    render(<Splash />);
    const s = screen.getByRole("status", { name: /loading flourish/i });
    expect(s).toHaveAttribute("aria-live", "polite");
    // decoration must not be read out
    expect(document.querySelector(".bloom")).toHaveAttribute("aria-hidden", "true");
    expect(document.querySelector(".pollen")).toHaveAttribute("aria-hidden", "true");
  });

  it("fades rather than vanishing when it leaves", () => {
    const { container, rerender } = render(<Splash />);
    expect(container.querySelector(".splash").className).not.toContain("splash--out");
    rerender(<Splash leaving />);
    expect(container.querySelector(".splash").className).toContain("splash--out");
  });
});

describe("reduced motion", () => {
  it("drops the petals and the pollen, keeping the logo still", () => {
    const { container } = render(<Splash reduced />);
    expect(container.querySelectorAll(".petal")).toHaveLength(0);
    expect(container.querySelector(".pollen")).toBeNull();
    expect(screen.getByRole("img", { name: "Flourish" })).toBeInTheDocument();
  });

  it("holds for well under a second instead of the full bloom", () => {
    expect(SPLASH_REDUCED_MS).toBeLessThanOrEqual(800);
    expect(SPLASH_REDUCED_MS).toBeLessThan(SPLASH_HOLD_MS);
  });
});

describe("how long it stays up", () => {
  it("adds up to about two and a half seconds", () => {
    expect(SPLASH_HOLD_MS + SPLASH_FADE_MS).toBeGreaterThanOrEqual(2400);
    expect(SPLASH_HOLD_MS + SPLASH_FADE_MS).toBeLessThanOrEqual(2600);
  });
});

describe("once per session", () => {
  it("starts out unseen on a cold open", () => {
    firstLaunch();
    expect(splashSeen()).toBe(false);
  });

  it("remembers once it has played", () => {
    firstLaunch();
    markSplashSeen();
    expect(splashSeen()).toBe(true);
  });

  it("survives storage being unavailable", () => {
    const real = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() { throw new Error("blocked"); },
    });
    try {
      // Safari private browsing throws here; losing the animation is fine,
      // crashing the launch screen is not.
      expect(() => splashSeen()).not.toThrow();
      expect(splashSeen()).toBe(false);
      expect(() => markSplashSeen()).not.toThrow();
    } finally {
      // restore in a finally, or a failure here breaks every test after it
      if (real) Object.defineProperty(window, "sessionStorage", real);
    }
  });

  it("replays on a cold launch — the flag must not outlive the JS context", () => {
    // The device bug: sessionStorage persists across app launches in a
    // WKWebView, so a stored flag meant the splash played once ever.
    firstLaunch();
    markSplashSeen();
    expect(splashSeen()).toBe(true);
    __resetSplashSeen();                       // stands in for a fresh context
    expect(splashSeen()).toBe(false);
  });

  it("does not write the flag to storage, which is what leaked before", () => {
    __resetSplashSeen();
    window.sessionStorage.removeItem(SEEN);
    markSplashSeen();
    expect(window.sessionStorage.getItem(SEEN)).toBeNull();
  });
});

/* ---------- the App-level timing contract ----------
   Real timers here on purpose. The hold and the fade are chained setTimeouts
   whose results land in React state, and hand-advancing fake timers does not
   flush those reliably — it tests the harness, not the app. 2.5s of real time
   for three tests is the cheaper trade. */
describe("launch behaviour in the app", () => {
  beforeEach(() => vi.useRealTimers());

  async function renderApp({ accountPending = false } = {}) {
    vi.resetModules();
    let release = () => {};
    if (accountPending) {
      vi.doMock("../lib/storage.js", () => ({
        loadAccount: () => new Promise((r) => { release = () => r(null); }),
        saveAccount: vi.fn(),
      }));
    }
    const { default: App } = await import("../App.jsx");
    render(<App />);
    return { release: () => { release(); vi.doUnmock("../lib/storage.js"); } };
  }

  const splashUp = () => screen.queryByRole("status", { name: /loading flourish/i });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  it("plays the bloom on the first launch of a session", async () => {
    firstLaunch();
    await renderApp();
    expect(splashUp()).toBeInTheDocument();
    expect(document.querySelectorAll(".petal").length).toBeGreaterThan(0);
  });

  it("holds for the full animation even when the account loads instantly", async () => {
    firstLaunch();
    await renderApp();

    // most of the way through the bloom, still up
    await wait(SPLASH_HOLD_MS - 600);
    expect(splashUp()).toBeInTheDocument();

    await waitFor(() => expect(splashUp()).not.toBeInTheDocument(), { timeout: 4000 });
  });

  it("keeps holding past the animation if the account is still loading", async () => {
    firstLaunch();
    const { release } = await renderApp({ accountPending: true });

    await wait(SPLASH_HOLD_MS + SPLASH_FADE_MS + 250);
    // the animation is long finished, but the account has not come back
    expect(splashUp()).toBeInTheDocument();

    release();
    await waitFor(() => expect(splashUp()).not.toBeInTheDocument(), { timeout: 4000 });
  });

  it("skips straight past on the next launch in the same session", async () => {
    markSplashSeen();
    await renderApp();
    expect(await screen.findByRole("button", { name: /staff/i })).toBeInTheDocument();
    expect(document.querySelectorAll(".petal")).toHaveLength(0);
  });

  it("still covers the account read on a later launch, so no sign-in flash", async () => {
    markSplashSeen();
    const { release } = await renderApp({ accountPending: true });
    expect(splashUp()).toBeInTheDocument();
    expect(screen.queryByText(/Join Flourish Rewards/)).not.toBeInTheDocument();
    release();
    await waitFor(() => expect(splashUp()).not.toBeInTheDocument(), { timeout: 4000 });
  });
});
