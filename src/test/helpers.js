import { screen, within } from "@testing-library/react";
import {
  isOpen, nextOpening, closingOn, formatTime, pickupSlots, readyFitsBeforeClose,
} from "../lib/hours.js";
import { cartPrepMinutes, readyWindow } from "../lib/prep.js";

/* Beef Patty used to be the convenient one-tap item in these tests. The
   printed-menu cull removed both patties, and everything left that sells on an
   ordinary weekday has at least a sides group — so adding an item now goes
   through the sheet.

   Ackee & Shrimp is the stand-in: $20 flat, one modifier group (two included
   sides, both $0), so the unit price is exactly $20 and never drifts. */
export const ACKEE = { id: "AYBW9QMTC6154", name: "Ackee & Shrimp", price: 20 };

/** The only items that still quick-add are Friday/Saturday ones. */
export const FRIDAY_QUICK = { name: "Shrimp", price: 21.99 };

/** Add one Ackee & Shrimp with its default sides. */
export async function addItem(user, { note } = {}) {
  const lunch = document.querySelector('section[data-cat="Lunch & Dinner"]');
  await user.click(
    within(lunch).getByRole("button", { name: new RegExp(`^Choose options for ${ACKEE.name}$`) })
  );
  const sheet = await screen.findByRole("dialog");
  if (note) await user.type(within(sheet).getByPlaceholderText(/gravy on the rice/i), note);
  await user.click(within(sheet).getByRole("button", { name: /^Add · \$/ }));
}

/** Fill the checkout contact fields. */
export async function fillDetails(user, name = "Nevaeh Reid", phone = "3478599413") {
  const n = screen.getByLabelText("Name");
  await user.clear(n); await user.type(n, name);
  const p = screen.getByLabelText("Phone number");
  await user.clear(p); await user.type(p, phone);
}

/* Pay-at-pickup still needs the proxy: with it unreachable the checkout button
   reads "Ordering not available right now" and is disabled, by design. Any test
   that actually places an order has to stand a healthy proxy up first. */
/* The register's answer to "has this been paid for?", which is what loyalty
   points hang on. `payment` is a mutable object so a test can place an order,
   assert no points, then flip it to paid and let the poll pick it up. */
export const unpaidOrder = () => ({
  paid: false, voided: false, refunded: false,
  paymentState: "OPEN", state: "open",
  total: 2000, amountPaid: 0,
  printed: true, manualReady: false, settled: false,
});

/* A 503 from the proxy, shaped the way lib/clover.js surfaces one. */
class ApiUnavailable extends Error {
  constructor() { super("Rewards aren't available right now."); this.code = "PETALS_UNAVAILABLE"; }
}

export function stubOnlineProxy({
  vi, order = {}, sandbox = true, quote = {},
  /* Called with the posted body before the stub answers. Throwing from it is
     how a test makes one order attempt fail — a dropped request, which is the
     case the idempotency key exists for. */
  onOrder = null,
  /* The Petals balance the SERVER reports. `null` stands for a proxy with no
     database — the endpoints 503 and the app must show the balance as
     unavailable while still taking orders. */
  petals = 0,
  payment = unpaidOrder(),
  loyalty = { configured: false, reason: "NO_PROGRAM", program: null, tiers: [], source: "in-app" },
} = {}) {
  const calls = { orders: [], quotes: [], status: [], petals: [] };
  /* The server's balance, mutable so a test can do what the real server does:
     move the number when a payment lands, and let the client find out by
     asking again rather than by doing its own arithmetic. */
  let balance = petals;
  let claimed = false;

  /* The ready window and the bookable slots are the SERVER's answers now, so
     the stub works them out the way server/app.js does — from the same shared
     functions, against the test's own fake clock. Hardcoding a window here
     would make every ordering test pass while the real thing quoted nonsense. */
  const quoteFor = (cart) => {
    const at = new Date();
    const prepMinutes = cartPrepMinutes(cart ?? []);
    const w = readyWindow(at, prepMinutes);
    const open = isOpen(at);
    const fitsBeforeClose = readyFitsBeforeClose(w.end, at);
    return {
      prepMinutes,
      startISO: w.start.toISOString(),
      endISO: w.end.toISOString(),
      label: w.label,
      fitsBeforeClose,
      closesAt: closingOn(at).toISOString(),
      open,
      slots: open && fitsBeforeClose
        ? pickupSlots(at, prepMinutes).map((d) => ({ iso: d.toISOString(), label: formatTime(d) }))
        : [],
      opensAt: open ? null : nextOpening(at).toISOString(),
      ...quote,
    };
  };

  const routes = {
    "GET /health": () => ({
      ok: true, configured: true, sandbox,
      printerConfigured: true, printerName: "Station Printer", printerType: "MY_LOCAL",
    }),
    "GET /inventory": () => ({ items: [] }),
    "POST /quote": (body) => { calls.quotes.push(body); return quoteFor(body?.cart); },
    "POST /orders": (body) => {
      calls.orders.push(body);
      if (onOrder) onOrder(body);
      const q = quoteFor(body?.cart);
      // A scheduled slot keeps its own time; otherwise the window is the label.
      const pickupLabel = body?.pickupAt ? formatTime(new Date(body.pickupAt)) : q.label;
      return {
        success: true, orderId: "CLV-TEST", orderNumber: body?.orderNumber ?? null,
        total: 2000, paid: false, printed: true, printError: null,
        printer: { uuid: "ZVZ9PRJ255V90", name: "Station Printer", type: "MY_LOCAL" },
        messaged: true, attached: true,
        pickupLabel,
        readyWindow: { startISO: q.startISO, endISO: q.endISO, label: pickupLabel },
        prepMinutes: q.prepMinutes,
        ...order,
      };
    },
    "POST /petals/balance": (body) => {
      calls.petals.push({ op: "balance", body });
      if (balance === null) throw new ApiUnavailable();
      return { petals: balance, known: true };
    },
    "POST /petals/claim": (body) => {
      calls.petals.push({ op: "claim", body });
      if (balance === null) throw new ApiUnavailable();
      /* The real server applies a device balance ONCE. Modelled, so a test can
         catch a client that sends it on every read. */
      if (typeof body?.deviceBalance === "number" && body.deviceBalance > 0 && !claimed) {
        balance += body.deviceBalance;
      }
      claimed = true;
      return { petals: balance, known: true };
    },
    "POST /customers": () => ({ customerId: "CUST-TEST", existing: false }),
    "GET /loyalty": () => loyalty,
  };

  /* Paths with an id in them cannot be looked up by exact string. */
  const dynamic = (method, path) => {
    const status = /^\/orders\/([^/]+)\/status$/.exec(path);
    if (method === "GET" && status) {
      return () => { calls.status.push(status[1]); return { id: status[1], ...payment }; };
    }
    const get = /^\/orders\/([^/]+)$/.exec(path);
    if (method === "GET" && get) {
      return () => ({ id: get[1], state: payment.state, total: payment.total, printed: payment.printed });
    }
    return null;
  };
  vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
    const path = String(url).replace("/api/clover", "").split("?")[0];
    const method = init.method || "GET";
    const handler = routes[`${method} ${path}`] ?? dynamic(method, path);
    if (!handler) throw new TypeError("Failed to fetch");
    let body;
    try {
      body = handler(init.body ? JSON.parse(init.body) : undefined);
    } catch (e) {
      /* A handler that throws ApiUnavailable stands for a real 503, so the
         client sees the status and code it would see in production rather than
         a transport failure. */
      if (e instanceof ApiUnavailable) {
        return { ok: false, status: 503, json: async () => ({ error: e.message, code: e.code }) };
      }
      throw e;
    }
    return { ok: true, status: 200, json: async () => body };
  }));
  /* Let a test change the register's answer mid-flight — the whole point of
     polling is that the answer changes while the customer is standing there. */
  calls.setPayment = (next) => Object.assign(payment, next);
  /* And let a test move the balance the way a real settlement does. */
  calls.setPetals = (n) => { balance = n; };
  calls.petalsBalance = () => balance;
  return calls;
}
