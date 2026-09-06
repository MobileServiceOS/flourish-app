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
  if (note) await user.type(within(sheet).getByPlaceholderText(/extra gravy/i), note);
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
export function stubOnlineProxy({ vi, order = {}, sandbox = true, quote = {} } = {}) {
  const calls = { orders: [], quotes: [] };

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
    "POST /customers": () => ({ customerId: "CUST-TEST", existing: false }),
  };
  vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
    const path = String(url).replace("/api/clover", "").split("?")[0];
    const handler = routes[`${init.method || "GET"} ${path}`];
    if (!handler) throw new TypeError("Failed to fetch");
    const body = handler(init.body ? JSON.parse(init.body) : undefined);
    return { ok: true, status: 200, json: async () => body };
  }));
  return calls;
}
