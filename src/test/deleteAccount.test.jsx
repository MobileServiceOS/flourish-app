import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { addItem, stubOnlineProxy } from "./helpers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const MON_NOON = new Date(2026, 6, 27, 12, 0);

/* ============================================================================
   DELETING AN ACCOUNT

   Apple guideline 5.1.1(v): an app that lets you create an account has to let
   you delete it from inside the app. "Call the restaurant" does not satisfy it.

   The line these tests hold is what deletion reaches. A Flourish account lives
   on the phone — a name, a number, a points balance — and all of that goes. The
   restaurant's own records do not: orders already sent to Clover are the shop's
   receipts for food they cooked and sold, and a customer deleting their app
   account must not reach back into somebody's books.
   ============================================================================ */

async function renderApp(stub = {}) {
  vi.setSystemTime(MON_NOON);
  vi.resetModules();
  const calls = stubOnlineProxy({ vi, ...stub });
  const { default: App } = await import("../App.jsx");
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<App />);
  await screen.findByRole("button", { name: /staff/i });
  return { user, calls };
}

async function signIn(user) {
  await user.click(screen.getByRole("button", { name: /^Sign in/ }));
  await user.type(await screen.findByLabelText("Full name"), "Nevaeh Reid");
  await user.type(screen.getByLabelText("Phone number"), "3478599413");
  await user.click(screen.getByRole("button", { name: /Create my account/ }));
  await screen.findByText("points available");
}

async function placeOrder(user) {
  await user.click(screen.getByRole("button", { name: /^Menu/ }));
  await addItem(user);
  await user.click(await screen.findByRole("button", { name: /cart, 1 item/i }));
  await user.click(await screen.findByRole("button", { name: /go to checkout/i }));
  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "Nevaeh Reid");
  await user.clear(screen.getByLabelText("Phone number"));
  await user.type(screen.getByLabelText("Phone number"), "3478599413");
  await user.click(screen.getByRole("button", { name: /^Place order/ }));
  await screen.findByText("Order confirmed");
  await user.click(screen.getByRole("button", { name: /Done, back to menu/ }));
}

const openAccount = async (user) => {
  await user.click(screen.getByRole("button", { name: /^Rewards/ }));
  await screen.findByText("points available");
};

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe("the account screen offers deletion", () => {
  it("has a Delete account control, as Apple requires", async () => {
    const { user } = await renderApp();
    await signIn(user);
    expect(screen.getByRole("button", { name: /^Delete account$/ })).toBeInTheDocument();
  });

  it("does not delete on the first tap", async () => {
    /* One tap deleting an account outright is how someone loses their points to
       a mis-tap on a scrolling screen. */
    const { user } = await renderApp();
    await signIn(user);
    await user.click(screen.getByRole("button", { name: /^Delete account$/ }));

    expect(screen.getByText(/Delete your account\?/)).toBeInTheDocument();
    // Still signed in: nothing has happened yet.
    expect(screen.getByText("points available")).toBeInTheDocument();
  });

  it("can be backed out of", async () => {
    const { user } = await renderApp();
    await signIn(user);
    await user.click(screen.getByRole("button", { name: /^Delete account$/ }));
    await user.click(screen.getByRole("button", { name: /Keep my account/ }));

    expect(screen.queryByText(/Delete your account\?/)).not.toBeInTheDocument();
    expect(screen.getByText("points available")).toBeInTheDocument();
  });
});

describe("the confirmation says what is actually lost", () => {
  it("names the saved details, the order history and the points", async () => {
    const { user } = await renderApp();
    await signIn(user);
    await placeOrder(user);
    await openAccount(user);
    await user.click(screen.getByRole("button", { name: /^Delete account$/ }));

    const panel = screen.getByRole("alertdialog");
    expect(within(panel).getByText(/saved name and phone number/i)).toBeInTheDocument();
    expect(within(panel).getByText(/order history/i)).toBeInTheDocument();
    /* The balance and the count themselves, not just the words. textContent
       runs adjacent elements together, so no trailing word boundary. */
    expect(panel.textContent).toMatch(/your 0 points/);
    expect(panel.textContent).toMatch(/\(1 order\)/);
  });

  it("says plainly that unspent points are forfeited", async () => {
    const { user } = await renderApp();
    await signIn(user);
    await user.click(screen.getByRole("button", { name: /^Delete account$/ }));

    const panel = screen.getByRole("alertdialog");
    expect(within(panel).getByText(/not spent are gone for good/i)).toBeInTheDocument();
    expect(within(panel).getByText(/cannot be restored/i)).toBeInTheDocument();
  });

  it("explains that the restaurant's own records are not touched", async () => {
    /* "Delete my account" reasonably sounds like it might reach the shop's
       books. It does not, and the customer is told so before they confirm
       rather than left to assume either way. */
    const { user } = await renderApp();
    await signIn(user);
    await user.click(screen.getByRole("button", { name: /^Delete account$/ }));

    const panel = screen.getByRole("alertdialog");
    expect(within(panel).getByText(/stay in the restaurant/i)).toBeInTheDocument();
    expect(within(panel).getByText(/bookkeeping/i)).toBeInTheDocument();
  });
});

describe("confirming deletes the account and its data", () => {
  const confirm = async (user) => {
    await user.click(screen.getByRole("button", { name: /^Delete account$/ }));
    await user.click(screen.getByRole("button", { name: /Delete for good/ }));
  };

  it("signs the customer out and clears the points", async () => {
    const { user } = await renderApp();
    await signIn(user);
    await confirm(user);

    // Back to the sign-up pitch: there is no account any more.
    await user.click(screen.getByRole("button", { name: /^Sign in/ }));
    expect(await screen.findByLabelText("Full name")).toBeInTheDocument();
    expect(screen.queryByText("points available")).not.toBeInTheDocument();
  });

  it("clears the order history", async () => {
    const { user } = await renderApp();
    await signIn(user);
    await placeOrder(user);
    await openAccount(user);
    await confirm(user);

    await user.click(screen.getByRole("button", { name: /^Orders/ }));
    expect(await screen.findByText(/No orders yet/i)).toBeInTheDocument();
  });

  it("erases the stored record, so a relaunch does not bring it back", async () => {
    const { user } = await renderApp();
    await signIn(user);
    const { loadAccount } = await import("../lib/storage.js");
    expect(await loadAccount()).toBeTruthy();

    await confirm(user);
    await waitFor(async () => expect(await loadAccount()).toBeNull());
  });

  it("leaves nothing personal in device storage", async () => {
    const { user } = await renderApp();
    await signIn(user);
    await confirm(user);

    // Whatever backend is in play, the name and number must be gone from both.
    await waitFor(() => {
      const dump = JSON.stringify({ ...globalThis.localStorage });
      expect(dump).not.toContain("Nevaeh");
      expect(dump).not.toContain("3478599413");
    });
  });
});

describe("deletion never touches the restaurant's records", () => {
  it("sends nothing to Clover", async () => {
    /* The shop's orders are its receipts for food it cooked. A customer
       deleting their app account must not reach into that. */
    const { user, calls } = await renderApp();
    await signIn(user);
    await placeOrder(user);
    const ordersBefore = calls.orders.length;
    expect(ordersBefore).toBe(1);

    await openAccount(user);
    await user.click(screen.getByRole("button", { name: /^Delete account$/ }));
    await user.click(screen.getByRole("button", { name: /Delete for good/ }));
    await vi.advanceTimersByTimeAsync(2000);

    // Not one further call of any kind on the customer's behalf.
    expect(calls.orders.length).toBe(ordersBefore);
    expect(calls.deletes ?? []).toHaveLength(0);
  });

  it("makes no network request at all, so it works with the proxy down", async () => {
    /* Deletion is local state. It must not depend on the kitchen being
       reachable — a customer on a plane, or with the shop shut, still gets to
       delete their account. */
    const { user } = await renderApp();
    await signIn(user);

    // The proxy falls over completely, mid-session.
    const dead = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    vi.stubGlobal("fetch", dead);

    await user.click(screen.getByRole("button", { name: /^Delete account$/ }));
    await user.click(screen.getByRole("button", { name: /Delete for good/ }));

    const { loadAccount } = await import("../lib/storage.js");
    await waitFor(async () => expect(await loadAccount()).toBeNull());
    expect(dead).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("does not call any delete endpoint, because none exists", async () => {
    const server = readFileSync(resolve(ROOT, "server/app.js"), "utf8");
    const client = readFileSync(resolve(ROOT, "src/lib/clover.js"), "utf8");
    expect(server).not.toMatch(/app\.delete\(/);
    expect(client).not.toMatch(/method:\s*["']DELETE["']/);
  });
});

/* ---------- the version the store sees ---------- */
describe("one version number, stamped from one place", () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));

  it("keeps package.json as the source of truth", () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.scripts["version:stamp"]).toBe("node scripts/stamp-version.mjs");
  });

  it("stamps the native project as part of sync, after cap sync regenerates it", () => {
    /* ios/ is gitignored and comes back from `npx cap add ios`, so a number
       typed into Xcode is lost. Stamping has to run after cap sync, next to the
       icons, which are restored for exactly the same reason. */
    const sync = pkg.scripts.sync;
    expect(sync).toContain("version:stamp");
    expect(sync.indexOf("cap sync")).toBeLessThan(sync.indexOf("version:stamp"));
  });

  it("leaves the build number alone, since it moves per upload", () => {
    const script = readFileSync(resolve(ROOT, "scripts/stamp-version.mjs"), "utf8");
    expect(script).toMatch(/MARKETING_VERSION/);
    expect(script).not.toMatch(/CURRENT_PROJECT_VERSION = /);
  });
});
