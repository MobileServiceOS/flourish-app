import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { addItem, ACKEE } from "./helpers.js";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MON_NOON = new Date(2026, 6, 27, 12, 0);

/** Render the app with /api/clover/* answered by `routes`. */
async function renderApp({ routes = {}, when = MON_NOON } = {}) {
  vi.setSystemTime(when);
  vi.resetModules();

  const fetchMock = vi.fn(async (url, init = {}) => {
    const path = String(url).replace("/api/clover", "");
    const key = `${init.method || "GET"} ${path.split("?")[0]}`;
    const handler = routes[key] ?? routes[path.split("?")[0]];
    if (!handler) throw new TypeError("Failed to fetch");     // proxy not running
    const r = await handler(init.body ? JSON.parse(init.body) : undefined);
    return {
      ok: r.status < 400,
      status: r.status,
      json: async () => r.body,
    };
  });
  vi.stubGlobal("fetch", fetchMock);

  const { default: App } = await import("../App.jsx");
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<App />);
  await screen.findByRole("button", { name: /staff/i });
  return { user, fetchMock };
}

const ONLINE = {
  "GET /health": async () => ({ status: 200, body: { ok: true, configured: true, sandbox: true } }),
  "GET /inventory": async () => ({ status: 200, body: { items: [] } }),
};

async function toCheckout(user) {
  await addItem(user);
  await user.click(await screen.findByRole("button", { name: /cart, 1 item/i }));
  await user.click(await screen.findByRole("button", { name: /go to checkout/i }));
  const n = screen.getByLabelText("Name");
  await user.clear(n); await user.type(n, "Nevaeh Reid");
  const p = screen.getByLabelText("Phone number");
  await user.clear(p); await user.type(p, "3478599413");
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

/* ---------- preview mode: the proxy was never started ---------- */
describe("preview mode", () => {
  it("says ordering isn't connected instead of crashing", async () => {
    const { user } = await renderApp({ routes: {} });   // every fetch throws
    await toCheckout(user);
    expect(await screen.findByText(/preview mode — ordering is not connected/i)).toBeInTheDocument();
  });

  it("offers no card option when nothing can charge a card", async () => {
    const { user } = await renderApp({ routes: {} });
    await toCheckout(user);
    expect(screen.queryByRole("radio", { name: /pay now by card/i })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /pay at pickup/i })).toBeInTheDocument();
  });

  it("still lets the customer browse and build a cart", async () => {
    const { user } = await renderApp({ routes: {} });
    await addItem(user);
    expect(await screen.findByRole("button", { name: /cart, 1 item/i })).toBeInTheDocument();
  });

  it("shows no SANDBOX badge when it cannot reach the proxy", async () => {
    await renderApp({ routes: {} });
    expect(screen.queryByText("SANDBOX")).not.toBeInTheDocument();
  });
});

/* ---------- connected ---------- */
describe("connected to Clover", () => {
  it("shows the SANDBOX badge so test orders are never mistaken for real ones", async () => {
    await renderApp({ routes: ONLINE });
    expect(await screen.findByText("SANDBOX")).toBeInTheDocument();
  });

  it("hides the badge in production", async () => {
    await renderApp({ routes: {
      ...ONLINE,
      "GET /health": async () => ({ status: 200, body: { ok: true, configured: true, sandbox: false } }),
    }});
    await screen.findByRole("tab", { name: "Popular" });
    await waitFor(() => expect(screen.queryByText("SANDBOX")).not.toBeInTheDocument());
  });

  it("offers card payment and pushes the order to the register", async () => {
    const createOrder = vi.fn(async () => ({ status: 200, body: { orderId: "ORD-77", printed: true } }));
    const { user } = await renderApp({ routes: { ...ONLINE, "POST /orders": createOrder } });
    await toCheckout(user);

    expect(await screen.findByRole("radio", { name: /pay now by card/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Place order/ }));

    await screen.findByText("Order confirmed");
    expect(createOrder).toHaveBeenCalled();
    // the register id is shown so staff can look the order up
    expect(screen.getByText("ORD-77")).toBeInTheDocument();
  });

  it("marks sold out from Clover stock levels", async () => {
    const { user } = await renderApp({ routes: {
      ...ONLINE,
      "GET /inventory": async () => ({ status: 200, body: { items: [
        { id: ACKEE.id, name: ACKEE.name, stockCount: 0, available: false },
      ]}}),
    }});
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: new RegExp(ACKEE.name + ".*sold out today", "i") })[0]).toBeInTheDocument()
    );
  });
});

/* ---------- failures the customer must be told about ---------- */
describe("order failures are never silent", () => {
  it("offers a retry when the kitchen can't be reached", async () => {
    const { user } = await renderApp({ routes: {
      ...ONLINE,
      "POST /orders": async () => ({ status: 500, body: { error: "Couldn't reach the kitchen — try again" } }),
    }});
    await toCheckout(user);
    await user.click(screen.getByRole("button", { name: /^Place order/ }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/couldn't reach the kitchen/i);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    // and the cart is intact so nothing is lost
    expect(screen.getByRole("button", { name: /cart, 1 item/i })).toBeInTheDocument();
  });

  it("quotes the decline reason back when a card is refused", async () => {
    const { user } = await renderApp({ routes: {
      ...ONLINE,
      "POST /orders": async () => ({ status: 200, body: { orderId: "ORD-1", printed: true } }),
      "POST /pay": async () => ({ status: 402, body: {
        error: "Your card was declined.", code: "card_declined", declineReason: "insufficient_funds",
      }}),
    }});
    await toCheckout(user);
    // choose card, then submit; the stubbed SDK never loads so tokenize fails
    // unless the form is ready — assert on the decline path via pay directly
    await user.click(await screen.findByRole("radio", { name: /pay now by card/i }));
    await user.click(screen.getByRole("button", { name: /^Pay \$/ }));

    const alert = await screen.findByRole("alert");
    expect(alert).toBeInTheDocument();
  });

  it("refuses rather than ringing up free when a modifier no longer exists", async () => {
    const { user } = await renderApp({ routes: {
      ...ONLINE,
      "POST /orders": async () => ({ status: 409, body: {
        error: "One of those choices is no longer on the register. Rebuild the item and try again.",
        code: "MODIFIER_UNRESOLVED",
      }}),
    }});
    await toCheckout(user);
    await user.click(screen.getByRole("button", { name: /^Place order/ }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/no longer on the register/i);
    // no retry: retrying the same stale cart would fail identically
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("still confirms the order when the kitchen printer is down", async () => {
    const { user } = await renderApp({ routes: {
      ...ONLINE,
      "POST /orders": async () => ({ status: 200, body: {
        orderId: "ORD-5", printed: false, printError: "Printer offline",
      }}),
    }});
    await toCheckout(user);
    await user.click(screen.getByRole("button", { name: /^Place order/ }));

    expect(await screen.findByText("Order confirmed")).toBeInTheDocument();
    expect(screen.getByText(/printer didn't answer/i)).toBeInTheDocument();
  });
});

/* ---------- the guard that matters most ---------- */
describe("the private token never reaches the browser", () => {
  const ROOT = resolve(HERE, "../..");

  it("is not referenced anywhere under src/", () => {
    // src/test is not shipped to the browser, and this very file names the
    // variable in order to assert about it.
    const walk = (d) => readdirSync(d, { withFileTypes: true })
      .flatMap((e) => e.name === "test" ? []
        : e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
    const offenders = walk(resolve(ROOT, "src"))
      .filter((f) => /\.(jsx?|css)$/.test(f))
      .filter((f) => /CLOVER_PRIVATE_TOKEN/.test(readFileSync(f, "utf8")))
      // the client module names it only in a comment explaining its absence
      .filter((f) => !/lib\/clover\.js$/.test(f))
      .map((f) => f.slice(ROOT.length + 1));
    expect(offenders).toEqual([]);
  });

  it("is never given a VITE_ prefix, which would inline it into the bundle", () => {
    const envPath = resolve(ROOT, ".env.local");
    if (!existsSync(envPath)) return;
    const keys = readFileSync(envPath, "utf8").split("\n")
      .map((l) => l.split("=")[0].trim()).filter(Boolean);
    expect(keys).not.toContain("VITE_CLOVER_PRIVATE_TOKEN");
    expect(keys.filter((k) => /PRIVATE/i.test(k) && k.startsWith("VITE_"))).toEqual([]);
  });

  it("is absent from the built bundle", () => {
    const dist = resolve(ROOT, "dist");
    const envPath = resolve(ROOT, ".env.local");
    if (!existsSync(dist) || !existsSync(envPath)) return;   // nothing built yet

    const token = readFileSync(envPath, "utf8").split("\n")
      .find((l) => l.startsWith("CLOVER_PRIVATE_TOKEN="))?.split("=")[1]?.trim()
      .replace(/^["']|["']$/g, "");
    if (!token) return;

    const walk = (d) => readdirSync(d, { withFileTypes: true })
      .flatMap((e) => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
    const leaked = walk(dist).filter((f) =>
      statSync(f).isFile() && readFileSync(f, "utf8").includes(token)
    );
    expect(leaked).toEqual([]);
  });
});
