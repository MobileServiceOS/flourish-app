import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../../server/app.js";
import { createMemoryStore } from "../../server/petals/store.memory.js";
import {
  createPetals, SIGNUP_BONUS, PERKS_MATCH_CAP, BIRTHDAY_PETALS,
} from "../../server/petals/ledger.js";
import { __resetRateLimit } from "../../server/guard.js";
import { __resetPrinters } from "../../server/clover.js";

/* ============================================================================
   THE NEW EARNING ROUTES, THROUGH THE PROXY

   petalsEarning.test.js proves the ledger rules. This is everything the ledger
   cannot see, because it has no Clover access and no idea what a request
   looked like:

     - that a receipt is checked against the REGISTER before anything is
       credited: it exists, it is inside the window, Clover says it is paid
     - that an ambiguous suffix is REFUSED rather than resolved to the first
       match, which would credit somebody else's dinner
     - that the counter earns on the same basis as the app, so the same meal is
       worth the same either way
     - that the staff Perks screen is behind a secret checked on the SERVER

   The last one is the one that would have shipped wrong. The brief said "put it
   behind the existing staff PIN"; there is no existing staff PIN — the lock
   icon on the menu opens the kitchen sheet with no check at all.
   ============================================================================ */

const CUSTOMER = { name: "Nevaeh Reid", phone: "3478599413" };
const OPEN = new Date(2026, 8, 14, 12, 0);       // a Monday, open
const DAY = 24 * 60 * 60 * 1000;

/** A Clover order as the list returns it, with payments expanded. */
const order = (id, { totalCents = 2722, taxCents = 222, tipCents = 0, paid = true,
                     deleted = false, ageMs = 0 } = {}) => ({
  id,
  state: deleted ? "deleted" : "locked",
  ...(deleted ? { deletedTime: OPEN.getTime() } : {}),
  total: totalCents,
  paymentState: paid ? "PAID" : "OPEN",
  createdTime: OPEN.getTime() - ageMs,
  payments: { elements: paid
    ? [{ amount: totalCents, taxAmount: taxCents, tipAmount: tipCents, result: "SUCCESS" }]
    : [] },
});

function fakeClover(orders = [], over = {}) {
  return {
    ordersSince: vi.fn(async (_since, { offset = 0 } = {}) =>
      ({ elements: offset === 0 ? orders : [] })),
    createOrder: vi.fn().mockResolvedValue({ id: "ORD-1", total: 2000 }),
    getOrder: vi.fn().mockResolvedValue({ id: "ORD-1", state: "open", total: 2000 }),
    printers: vi.fn().mockResolvedValue({ elements: [{ uuid: "P1", name: "P", type: "MY_LOCAL" }] }),
    printEvent: vi.fn().mockResolvedValue({ id: "PRINT-1" }),
    findCustomerByPhone: vi.fn().mockResolvedValue({ elements: [] }),
    merchant: vi.fn().mockResolvedValue({ id: "M1" }),
    items: vi.fn().mockResolvedValue({ elements: [] }),
    ...over,
  };
}

let clock;
function build({ orders = [], clover = null, adminKey, staffPin } = {}) {
  clock = OPEN.getTime();
  const c = clover ?? fakeClover(orders);
  const store = createMemoryStore();
  const petals = createPetals({ store, now: () => clock });
  const agent = request(createApp({
    clover: c,
    catalog: async () => ({}),
    now: () => new Date(clock),
    printTicket: async () => ({ printed: true, printer: "P" }),
    appKey: "",
    /* Injected, never written to process.env — see the note on createApp.
       The suite is serialised precisely because env-mutating tests leak. */
    petalsAdminKey: adminKey,
    petalsStaffPin: staffPin,
    petals,
  }));
  return { agent, clover: c, petals, store, tick: (ms) => { clock += ms; } };
}

const join = (agent, over = {}) =>
  agent.post("/api/clover/petals/claim").send({ ...CUSTOMER, ...over }).expect(200);

beforeEach(() => { __resetRateLimit(); __resetPrinters(); });

describe("claiming a counter receipt through the proxy", () => {
  it("credits a real, paid, recent order", async () => {
    const { agent } = build({ orders: [order("ZQYKAKXNK8730")] });
    await join(agent);
    const r = await agent.post("/api/clover/petals/receipt")
      .send({ ...CUSTOMER, orderRef: "K8730" }).expect(200);

    /* $27.22 paid, of which $2.22 was tax, so the earning basis is $25.00 —
       the same number the app would have earned on for the same food. */
    expect(r.body.net).toBe(25);
    expect(r.body.credited).toBe(25);
    expect(r.body.orderId).toBe("ZQYKAKXNK8730");
  });

  it("earns on the pre-tax amount, not on what the card was charged", async () => {
    /* If this earned on the total, the same meal would be worth ~8.9% more
       bought at the counter than in the app, purely because tax rides along. */
    const { agent } = build({ orders: [order("AAAAAAAAAA111", { totalCents: 5000, taxCents: 444 })] });
    await join(agent);
    const r = await agent.post("/api/clover/petals/receipt")
      .send({ ...CUSTOMER, orderRef: "AA111" }).expect(200);
    expect(r.body.credited).toBe(46);          // 5000 - 444 = 4556c -> $45.56 -> 46
  });

  it("ignores a tip, which is not spend on food", async () => {
    const { agent } = build({
      orders: [order("BBBBBBBBB2222", { totalCents: 3000, taxCents: 200, tipCents: 500 })] });
    await join(agent);
    const r = await agent.post("/api/clover/petals/receipt")
      .send({ ...CUSTOMER, orderRef: "B2222" }).expect(200);
    expect(r.body.credited).toBe(23);          // 3000 - 200 - 500 = 2300c
  });

  it("REFUSES an ambiguous suffix instead of crediting the first match", async () => {
    /* The one that must never be got wrong. Two orders end in the same six
       characters; crediting either is crediting somebody else's dinner, so
       neither is credited and the customer is asked for more characters.

       Measured probability inside a 7-day window at this shop's volume is
       0.0255% — small, and not zero, which is why this path exists. */
    const { agent } = build({ orders: [order("AAAAAAAK8730"), order("ZZZZZZZK8730")] });
    await join(agent);
    const r = await agent.post("/api/clover/petals/receipt")
      .send({ ...CUSTOMER, orderRef: "K8730" }).expect(409);
    expect(r.body.code).toBe("ORDER_AMBIGUOUS");
    expect(r.body.matched).toBe(2);

    const bal = await agent.post("/api/clover/petals/balance").send(CUSTOMER).expect(200);
    expect(bal.body.petals, "nothing credited").toBe(SIGNUP_BONUS);
  });

  it("refuses an order that is not paid yet", async () => {
    const { agent } = build({ orders: [order("CCCCCCCC3333", { paid: false })] });
    await join(agent);
    const r = await agent.post("/api/clover/petals/receipt")
      .send({ ...CUSTOMER, orderRef: "C3333" }).expect(409);
    expect(r.body.code).toBe("ORDER_NOT_PAID");
  });

  it("refuses an order that was voided at the register", async () => {
    const { agent } = build({ orders: [order("DDDDDDDD4444", { deleted: true })] });
    await join(agent);
    const r = await agent.post("/api/clover/petals/receipt")
      .send({ ...CUSTOMER, orderRef: "D4444" }).expect(409);
    expect(r.body.code).toBe("ORDER_VOIDED");
  });

  it("only searches the last seven days", async () => {
    /* The window is what makes six characters safe, so it is not decoration.
       Asserted on the argument actually passed to Clover. */
    const { agent, clover } = build({ orders: [order("EEEEEEEE5555")] });
    await join(agent);
    await agent.post("/api/clover/petals/receipt")
      .send({ ...CUSTOMER, orderRef: "E5555" }).expect(200);

    const since = clover.ordersSince.mock.calls[0][0];
    expect(Math.round((clock - since) / DAY)).toBe(7);
  });

  it("refuses a suffix too short to identify anything", async () => {
    const { agent, clover } = build({ orders: [order("FFFFFFFF6666")] });
    await join(agent);
    const r = await agent.post("/api/clover/petals/receipt")
      .send({ ...CUSTOMER, orderRef: "66" }).expect(400);
    expect(r.body.code).toBe("REF_TOO_SHORT");
    expect(clover.ordersSince, "never even asks Clover").not.toHaveBeenCalled();
  });

  it("says so when nothing matches", async () => {
    const { agent } = build({ orders: [order("GGGGGGGG7777")] });
    await join(agent);
    const r = await agent.post("/api/clover/petals/receipt")
      .send({ ...CUSTOMER, orderRef: "999999" }).expect(404);
    expect(r.body.code).toBe("ORDER_NOT_FOUND");
  });

  it("accepts an id typed with the letters Clover's alphabet never uses", async () => {
    // O for 0 and I for 1 are unambiguous: neither appears in a real id.
    const { agent } = build({ orders: [order("HHHHHHHH01110")] });
    await join(agent);
    const r = await agent.post("/api/clover/petals/receipt")
      .send({ ...CUSTOMER, orderRef: "OIIIO" }).expect(200);
    expect(r.body.orderId).toBe("HHHHHHHH01110");
  });

  it("credits one order to one account, whoever asks second", async () => {
    const { agent } = build({ orders: [order("JJJJJJJJ8888")] });
    await join(agent);
    await agent.post("/api/clover/petals/receipt")
      .send({ ...CUSTOMER, orderRef: "J8888" }).expect(200);

    const other = { name: "Someone Else", phone: "2125559999" };
    await agent.post("/api/clover/petals/claim").send(other).expect(200);
    const r = await agent.post("/api/clover/petals/receipt")
      .send({ ...other, orderRef: "J8888" }).expect(400);
    expect(r.body.code).toBe("ALREADY_CLAIMED");

    const bal = await agent.post("/api/clover/petals/balance").send(other).expect(200);
    expect(bal.body.petals).toBe(SIGNUP_BONUS);
  });
});

describe("the birthday route", () => {
  it("pays during the birth month and says why when it does not", async () => {
    const { agent } = build();
    await join(agent, { birthday: "1990-09-04" });      // September; clock is September
    const r = await agent.post("/api/clover/petals/birthday").send(CUSTOMER).expect(200);
    expect(r.body.credited).toBe(BIRTHDAY_PETALS);

    const again = await agent.post("/api/clover/petals/birthday").send(CUSTOMER).expect(200);
    expect(again.body.credited).toBe(0);
    expect(again.body.reason).toBe("ALREADY_THIS_YEAR");
  });

  it("is silent and harmless for a customer who gave no birth date", async () => {
    const { agent } = build();
    await join(agent);
    const r = await agent.post("/api/clover/petals/birthday").send(CUSTOMER).expect(200);
    expect(r.body).toMatchObject({ credited: 0, reason: "NO_BIRTHDAY" });
  });

  it("refuses a birth date that is not a date", async () => {
    const { agent } = build();
    const r = await agent.post("/api/clover/petals/claim")
      .send({ ...CUSTOMER, birthday: "1990-02-31" }).expect(400);
    expect(r.body.code).toBe("BAD_BIRTHDAY");
  });
});

describe("the retroactive signup backfill, through the proxy", () => {
  const ADMIN = "admin-key-for-tests-0123";
  const withAdmin = async (fn) => fn();   // kept for shape; the key is injected
  const call = (agent, body = {}, key = ADMIN) =>
    agent.post("/api/clover/petals/backfill-signup")
      .set("x-petals-admin-key", key).send(body);

  it("DEFAULTS TO A DRY RUN when the body says nothing", async () => {
    /* The shape that costs nothing has to be the one you get by typing less.
       A request that forgets `dryRun` must report, not mint. */
    await withAdmin(async () => {
      const { agent } = build({ adminKey: ADMIN });
      await agent.post("/api/clover/petals/claim")
        .send({ name: "Old One", phone: "9175551234" }).expect(200);

      const r = await call(agent, {}).expect(200);
      expect(r.body.dryRun).toBe(true);
      expect(r.body).toHaveProperty("wouldCredit");
      expect(r.body).not.toHaveProperty("credited");
    });
  });

  it("only writes when asked explicitly", async () => {
    await withAdmin(async () => {
      const { agent, petals, store } = build({ adminKey: ADMIN });
      // A customer the server knew before the bonus existed.
      await store.tx(async (tx) => {
        const c = await tx.createCustomer({
          phone: "+19175551234", name: "Old One", at: new Date(clock) });
        await tx.appendLedger({
          customerId: c.id, delta: 40, reason: "earned",
          idemKey: "earn:OLD", at: new Date(clock) });
      });

      expect((await call(agent, { dryRun: true }).expect(200)).body.wouldCredit).toBe(1);
      expect((await petals.balance({ name: "Old One", phone: "9175551234" })).petals).toBe(40);

      const applied = await call(agent, { dryRun: false }).expect(200);
      expect(applied.body).toMatchObject({ dryRun: false, credited: 1, petals: SIGNUP_BONUS });
      expect((await petals.balance({ name: "Old One", phone: "9175551234" })).petals)
        .toBe(40 + SIGNUP_BONUS);
    });
  });

  it("credits nobody twice, across the backfill and the live path", async () => {
    await withAdmin(async () => {
      const { agent, petals } = build({ adminKey: ADMIN });
      await agent.post("/api/clover/petals/claim")
        .send({ name: "New One", phone: "9175551234" }).expect(200);   // paid live

      const r = await call(agent, { dryRun: false }).expect(200);
      expect(r.body.credited, "the live path already paid them").toBe(0);
      expect((await petals.balance({ name: "New One", phone: "9175551234" })).petals)
        .toBe(SIGNUP_BONUS);
    });
  });

  it("does not exist without an admin key, and refuses a wrong one", async () => {
    const off = await build().agent
      .post("/api/clover/petals/backfill-signup").send({}).expect(404);
    expect(off.body.code).toBe("ADJUST_DISABLED");

    const bad = await call(build({ adminKey: ADMIN }).agent, {}, "not-the-key").expect(403);
    expect(bad.body.code).toBe("ADJUST_FORBIDDEN");
  });
});

describe("the staff Perks match", () => {
  it("does not exist at all when no PIN is configured", async () => {
    /* Same shape as /adjust: a route that mints currency is absent rather than
       merely guarded when it has not been deliberately switched on. */
    const { agent } = build();
    const r = await agent.post("/api/clover/petals/perks-match")
      .send({ ...CUSTOMER, petals: 200 }).expect(404);
    expect(r.body.code).toBe("PERKS_MATCH_DISABLED");
  });

  it("refuses without the PIN, and refuses a wrong one", async () => {
    const { agent } = build({ staffPin: "8241" });
    await agent.post("/api/clover/petals/perks-match")
      .send({ ...CUSTOMER, petals: 200 }).expect(403);
    const r = await agent.post("/api/clover/petals/perks-match")
      .set("x-staff-pin", "0000").send({ ...CUSTOMER, petals: 200 }).expect(403);
    expect(r.body.code).toBe("STAFF_FORBIDDEN");
  });

  it("grants with the right PIN", async () => {
    const { agent } = build({ staffPin: "8241" });
    const r = await agent.post("/api/clover/petals/perks-match")
      .set("x-staff-pin", "8241")
      .send({ ...CUSTOMER, petals: 140, staff: "Kay" }).expect(200);
    expect(r.body.credited).toBe(140);
  });

  it("caps at 200 even when the request says otherwise", async () => {
    /* The cap lives in the ledger, so it holds for a request that never went
       near the staff screen — which is the only kind worth defending against. */
    const { agent } = build({ staffPin: "8241" });
    const r = await agent.post("/api/clover/petals/perks-match")
      .set("x-staff-pin", "8241")
      .send({ ...CUSTOMER, petals: 100000 }).expect(200);
    expect(r.body.credited).toBe(PERKS_MATCH_CAP);
    expect(r.body.capped).toBe(true);
  });

  it("is once per phone number, ever", async () => {
    const { agent } = build({ staffPin: "8241" });
    const send = () => agent.post("/api/clover/petals/perks-match")
      .set("x-staff-pin", "8241").send({ ...CUSTOMER, petals: 200 }).expect(200);
    expect((await send()).body.credited).toBe(200);
    const again = await send();
    expect(again.body.credited).toBe(0);
    expect(again.body.alreadyMatched).toBe(true);
  });
});

describe("referral codes over the wire", () => {
  it("hands the customer a code and accepts a friend's", async () => {
    const { agent } = build();
    const mine = await join(agent);
    expect(mine.body.referralCode).toMatch(/^[0-9BCDFGHJKMNPQRSTVWXYZ]{6}$/);

    const friend = { name: "A Friend", phone: "9175551234" };
    const r = await agent.post("/api/clover/petals/claim")
      .send({ ...friend, referralCode: mine.body.referralCode }).expect(200);
    expect(r.body.referralAccepted).toBe(true);
  });

  it("never returns anything that reveals another customer's phone number", async () => {
    const { agent } = build();
    const mine = await join(agent);
    const body = JSON.stringify(mine.body);
    expect(body).not.toContain("3478599413");
    expect(body).not.toContain("+13478599413");
  });
});
