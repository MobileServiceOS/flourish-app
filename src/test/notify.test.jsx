import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/* notify.js talks to Capacitor when native and the Notification API otherwise.
   These tests drive the browser path, plus every permission state, because the
   denied path is the one customers actually hit. */

async function loadNotify() {
  vi.resetModules();
  return import("../lib/notify.js");
}

/** Stub the browser Notification API at a given permission. */
function stubNotification(permission, { onNew, grants = "granted" } = {}) {
  const ctor = vi.fn(function (title, opts) { onNew?.(title, opts); });
  ctor.permission = permission;
  // A real browser flips Notification.permission once the user answers, and
  // the scheduler re-reads it — so the stub has to do the same or it tests
  // a state that cannot happen.
  ctor.requestPermission = vi.fn(async () => {
    const answer = permission === "default" ? grants : permission;
    ctor.permission = answer;
    return answer;
  });
  vi.stubGlobal("Notification", ctor);
  return ctor;
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("permission state", () => {
  it("reports unsupported when the platform has no notifications", async () => {
    vi.stubGlobal("Notification", undefined);
    const n = await loadNotify();
    expect(await n.permissionState()).toBe("unsupported");
  });

  it("reports prompt when we have not asked yet", async () => {
    stubNotification("default");
    const n = await loadNotify();
    expect(await n.permissionState()).toBe("prompt");
  });

  it("reports granted and denied as they are", async () => {
    stubNotification("granted");
    expect(await (await loadNotify()).permissionState()).toBe("granted");
    stubNotification("denied");
    expect(await (await loadNotify()).permissionState()).toBe("denied");
  });

  it("never throws when the platform misbehaves", async () => {
    const bad = function () {};
    bad.permission = "default";
    bad.requestPermission = () => { throw new Error("nope"); };
    vi.stubGlobal("Notification", bad);
    const n = await loadNotify();
    await expect(n.requestPermission()).resolves.toBe("unsupported");
  });
});

describe("scheduling the order-ready alert", () => {
  const soon = () => new Date(Date.now() + 15 * 60_000);

  it("fires at the ready time, not before", async () => {
    const fired = [];
    stubNotification("granted", { onNew: (t, o) => fired.push({ t, body: o?.body }) });
    const n = await loadNotify();

    expect(await n.scheduleOrderReady({ orderNum: "FL-1234", at: soon(), itemCount: 2 })).toBe(true);
    expect(fired).toHaveLength(0);

    vi.advanceTimersByTime(15 * 60_000 + 10);
    await waitFor(() => expect(fired).toHaveLength(1));
    expect(fired[0].t).toBe("Your order is ready");
    expect(fired[0].body).toContain("FL-1234");
    expect(fired[0].body).toContain("2 items");
    expect(fired[0].body).toContain("4035 Laconia Ave");
  });

  it("schedules nothing without permission", async () => {
    stubNotification("denied");
    const n = await loadNotify();
    expect(await n.scheduleOrderReady({ orderNum: "FL-1", at: soon() })).toBe(false);
  });

  it("schedules nothing for a time already gone", async () => {
    stubNotification("granted");
    const n = await loadNotify();
    expect(await n.scheduleOrderReady({ orderNum: "FL-1", at: new Date(Date.now() - 60_000) })).toBe(false);
  });

  it("ignores a nonsense ready time rather than throwing", async () => {
    stubNotification("granted");
    const n = await loadNotify();
    expect(await n.scheduleOrderReady({ orderNum: "FL-1", at: "not a date" })).toBe(false);
    expect(await n.scheduleOrderReady({ orderNum: "FL-1", at: undefined })).toBe(false);
  });

  it("does not fire once cancelled", async () => {
    const fired = [];
    stubNotification("granted", { onNew: () => fired.push(1) });
    const n = await loadNotify();

    await n.scheduleOrderReady({ orderNum: "FL-9", at: soon() });
    await n.cancelOrderReady("FL-9");
    vi.advanceTimersByTime(20 * 60_000);
    expect(fired).toHaveLength(0);
  });

  it("gives an order a stable integer id the native scheduler can use", async () => {
    const n = await loadNotify();
    const id = n.notificationId("FL-1234");
    expect(Number.isInteger(id)).toBe(true);
    expect(id).toBeGreaterThan(0);
    expect(id).toBeLessThanOrEqual(2_147_483_647);
    expect(n.notificationId("FL-1234")).toBe(id);            // stable
    expect(n.notificationId("FL-5678")).not.toBe(id);        // distinct
  });
});

describe("the prompt on the confirmation screen", () => {
  const props = { orderNum: "FL-1234", readyAt: new Date(Date.now() + 15 * 60_000), itemCount: 1 };

  async function renderPrompt() {
    vi.resetModules();
    const { default: NotifyPrompt } = await import("../components/NotifyPrompt.jsx");
    render(<NotifyPrompt {...props} />);
  }

  it("offers to notify when permission has not been asked for", async () => {
    stubNotification("default");
    await renderPrompt();
    expect(await screen.findByRole("button", { name: /tell me when it's ready/i })).toBeInTheDocument();
  });

  it("asks the OS only when the customer opts in", async () => {
    const ctor = stubNotification("default");
    await renderPrompt();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    expect(ctor.requestPermission).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: /tell me when it's ready/i }));
    expect(ctor.requestPermission).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/we'll notify you when it's ready/i)).toBeInTheDocument();
  });

  it("handles the customer declining the OS prompt", async () => {
    stubNotification("default", { grants: "denied" });
    await renderPrompt();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(await screen.findByRole("button", { name: /tell me when it.s ready/i }));
    expect(await screen.findByText(/notifications are off/i)).toBeInTheDocument();
  });

  it("says something useful instead of nagging when permission is denied", async () => {
    stubNotification("denied");
    await renderPrompt();
    expect(await screen.findByText(/notifications are off/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /tell me when/i })).not.toBeInTheDocument();
  });

  it("shows nothing at all where notifications do not exist", async () => {
    vi.stubGlobal("Notification", undefined);
    const { container } = (() => {
      return { container: document.createElement("div") };
    })();
    await renderPrompt();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /tell me when/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/notifications are off/i)).not.toBeInTheDocument();
    });
    expect(container).toBeTruthy();
  });
});

describe("the app no longer promises a text message", () => {
  it("says nothing about texting anywhere a customer can read", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { resolve, dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

    const walk = (d) => readdirSync(d, { withFileTypes: true })
      .flatMap((e) => e.name === "test" || e.name === "node_modules" || e.name === "dist" ? []
        : e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);

    const offenders = [];
    for (const f of [...walk(resolve(ROOT, "src")), ...walk(resolve(ROOT, "docs"))]) {
      if (!/\.(jsx?|html|md)$/.test(f)) continue;
      const body = readFileSync(f, "utf8");
      if (/we'?ll text you|text you when|text this number|we text the number/i.test(body)) {
        offenders.push(f.slice(ROOT.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });
});
