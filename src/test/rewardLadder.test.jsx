import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { addItem, stubOnlineProxy } from "./helpers.js";
import { CURRENCY_MANY } from "../lib/currency.js";
import { REWARDS, hydrateRewards, discountFor, serialisableRewards } from "../lib/loyalty.js";
import { buildLabel, buildDetail } from "../lib/build.js";

/* ============================================================================
   THE CLIENT MUST NOT BE AUTHORITATIVE ABOUT A PRICE

   A shipped build showed "up to $22 off a plate" while the server computed $20,
   because the bundle was cut seven hours before the cap changed. The customer
   reads one number and is charged by another — the same class as every price
   divergence in this project, except between our own two halves.

   A "please update" notice would have been a stopgap a customer ignores. The
   ladder comes from the server instead, so the cap shown and the cap enforced
   are the same number from the same place, and the drift cannot happen.

   Only `match` — the predicate over cart lines — stays in the client, because
   it is code and cannot be serialised.
   ============================================================================ */

const MON_NOON = new Date(2026, 6, 27, 12, 0);

async function launch(stub = {}) {
  vi.setSystemTime(MON_NOON);
  vi.resetModules();
  const calls = stubOnlineProxy({ vi, ...stub });
  const { default: App } = await import("../App.jsx");
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<App />);
  await screen.findByRole("button", { name: /staff/i });
  return { user, calls };
}

async function seed(points = 0) {
  const { saveAccount } = await import("../lib/storage.js");
  await saveAccount({ name: "Nevaeh Reid", phone: "3478599413", points, orders: [], vouchers: [] });
}

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  globalThis.localStorage.clear();
  const { deleteAccount } = await import("../lib/storage.js");
  await deleteAccount();
});
afterEach(() => vi.useRealTimers());

describe("only the matcher is local", () => {
  it("sends no code over the wire", () => {
    for (const r of serialisableRewards()) {
      for (const v of Object.values(r)) expect(typeof v).not.toBe("function");
      expect(r).not.toHaveProperty("match");
    }
  });

  it("carries every field a customer reads", () => {
    for (const r of serialisableRewards()) {
      expect(Object.keys(r).sort()).toEqual(["cap", "cost", "desc", "id", "kind", "name", "needs"]);
    }
  });

  it("re-attaches the matcher by id", () => {
    const { rewards, fromServer } = hydrateRewards(serialisableRewards());
    expect(fromServer).toBe(true);
    for (const r of rewards) expect(typeof r.match, r.id).toBe("function");
  });

  it("falls back to the bundled ladder when the server says nothing", () => {
    for (const empty of [null, undefined, []]) {
      const { rewards, fromServer } = hydrateRewards(empty);
      expect(fromServer).toBe(false);
      expect(rewards).toBe(REWARDS);
    }
  });
});

describe("the server's cap is the one used", () => {
  it("computes the discount from the SERVER's cap, not the bundled one", () => {
    /* The exact drift: a client bundled at $22 against a server saying $20. */
    const server = serialisableRewards().map((r) => (r.id === "r-plate" ? { ...r, cap: 20 } : r));
    const stale = serialisableRewards().map((r) => (r.id === "r-plate" ? { ...r, cap: 22 } : r));

    const plate = [{ plate: true, price: 25 }];
    expect(discountFor({ rid: "r-plate" }, plate, hydrateRewards(server).rewards)).toBe(20);
    expect(discountFor({ rid: "r-plate" }, plate, hydrateRewards(stale).rewards)).toBe(22);
  });

  it("shows the server's figure on the rewards screen", async () => {
    /* Hand the client a ladder that differs from its bundle and check the
       SCREEN follows the server. If the client were still reading its own
       REWARDS this would show $20. */
    await seed(1000);
    const bent = serialisableRewards().map((r) =>
      (r.id === "r-plate" ? { ...r, cap: 17.5, name: "Free plate" } : r));
    const { user } = await launch({ petals: 1000, serverRewards: bent });

    await user.click(screen.getByRole("button", { name: /^Rewards/ }));
    await screen.findByText(`${CURRENCY_MANY} available`);
    expect(await screen.findByText("up to $17.50 off a plate")).toBeInTheDocument();
    expect(screen.queryByText("up to $20.00 off a plate")).not.toBeInTheDocument();
  });

  it("asks the server once per launch", async () => {
    await seed(1000);
    const { calls } = await launch({ petals: 1000 });
    await waitFor(() => expect(calls.rewards.length).toBe(1));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls.rewards.length).toBe(1);
  });
});

describe("a reward this build does not understand", () => {
  it("is shown but never applied, rather than guessed at", () => {
    /* An old client meeting a new reward must not apply some other predicate to
       it. The server may still honour it; this client cannot say what it
       covers. */
    const { rewards } = hydrateRewards([
      { id: "r-future", cost: 50, kind: "item", cap: 9, name: "Something new", desc: "", needs: "x" },
    ]);
    expect(rewards[0].unsupported).toBe(true);
    expect(discountFor({ rid: "r-future" }, [{ plate: true, price: 25 }], rewards)).toBe(0);
  });

  it("says to update rather than showing a shortfall", async () => {
    await seed(1000);
    const { user } = await launch({
      petals: 1000,
      serverRewards: [{ id: "r-future", cost: 50, kind: "item", cap: 9, name: "Something new", desc: "", needs: "x" }],
    });
    await user.click(screen.getByRole("button", { name: /^Rewards/ }));
    expect(await screen.findByText("Update the app to use this reward")).toBeInTheDocument();
  });
});

describe("the build is on screen", () => {
  it("labels the version, the build number and the date", () => {
    const label = buildLabel({ version: "1.1.0", build: "5", at: "2026-09-13T01:00:00.000Z" });
    expect(label).toMatch(/^1\.1\.0 \(5\) · \w+ \d+$/);   // e.g. "Sep 12"
  });

  it("survives a bundle with no stamp, rather than throwing", () => {
    expect(buildLabel({ version: "dev", build: "", at: null })).toBe("dev");
    expect(buildDetail({ version: "dev", build: "", at: null })).toBe("dev");
  });

  it("is rendered on the Rewards screen", async () => {
    /* The date is the part that matters: a version says what was intended, a
       date says whether this bundle predates the change being looked for. */
    await seed(0);
    const { user } = await launch({ petals: 0 });
    await user.click(screen.getByRole("button", { name: /^Rewards/ }));
    expect(await screen.findByText(/Flourish BX (dev|\d+\.\d+\.\d+)/)).toBeInTheDocument();
  });

  it("says when it is showing bundled prices", async () => {
    /* If the ladder could not be fetched the caps on screen are the bundle's,
       which is exactly the state that misled a customer before. Said plainly. */
    await seed(0);
    const { user } = await launch({ petals: 0, serverRewards: [] });
    await user.click(screen.getByRole("button", { name: /^Rewards/ }));
    expect(await screen.findByText(/offline prices/)).toBeInTheDocument();
  });
});
