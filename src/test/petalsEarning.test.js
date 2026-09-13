import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStore } from "../../server/petals/store.memory.js";
import {
  createPetals, PetalsError, normaliseOrderRef, parseBirthday,
  SIGNUP_BONUS, REFERRAL_BONUS, PERKS_MATCH_CAP, BIRTHDAY_PETALS,
  RECEIPT_CLAIMS_PER_DAY,
} from "../../server/petals/ledger.js";

/* ============================================================================
   FIVE WAYS TO EARN WITHOUT ORDERING IN THE APP

   Receipt claim, signup bonus, birthday, referral, Perks match. They share one
   ledger and one fraud surface, so they are tested together.

   THE HAPPY PATHS ARE THE LEAST INTERESTING CASES HERE. Every one of these
   mints something that behaves like money, and the controls are all the same
   shape — a deterministic idem_key with a UNIQUE index behind it — so what
   these tests are really checking is that the key is keyed on the right thing.
   Key a receipt claim on the customer instead of the order and two people can
   claim one receipt. Key a birthday on the date instead of the year and
   editing the date mints another. Key a referral on the referrer instead of
   the referee and a referrer earns once in their life instead of once per
   friend.

   So most of what follows is an attack, not a feature.
   ============================================================================ */

const NAME = "Nevaeh Reid";
const PHONE = "4757776200";
const FRIEND = "9175551234";
const STRANGER = "2125559999";

/* A fixed clock. Every one of these controls is about "once ever" or "once this
   year" or "three a day", none of which can be tested against a moving one. */
const JULY_2026 = Date.UTC(2026, 6, 15, 16, 0);

const setup = (at = JULY_2026) => {
  let clock = at;
  const store = createMemoryStore();
  const petals = createPetals({ store, now: () => clock });
  return { store, petals, tick: (ms) => { clock += ms; }, at: () => clock };
};

const join = (petals, over = {}) =>
  petals.claim({ name: NAME, phone: PHONE, ...over });

describe("the signup bonus", () => {
  let ctx;
  beforeEach(() => { ctx = setup(); });

  it("gives 50 Petals for a new account", async () => {
    const r = await join(ctx.petals);
    expect(r.signupBonus).toBe(SIGNUP_BONUS);
    expect(r.petals).toBe(SIGNUP_BONUS);
  });

  it("does NOT give a second one on every later sign-in", async () => {
    await join(ctx.petals);
    const again = await join(ctx.petals);
    expect(again.signupBonus).toBe(0);
    expect(again.petals).toBe(SIGNUP_BONUS);
  });

  it("is not restorable by deleting the app and signing up again", async () => {
    /* Delete the app, reinstall, sign up. The local account is gone and the
       client looks brand new; the ledger remembers the phone number. */
    await join(ctx.petals);
    const sameLedger = createPetals({ store: ctx.store, now: ctx.at });
    const r = await sameLedger.claim({ name: NAME, phone: PHONE });
    expect(r.signupBonus).toBe(0);
    expect(r.petals).toBe(SIGNUP_BONUS);
  });

  it("still pays someone whose row was created by staff before they joined", async () => {
    /* WHY THE KEY AND NOT AN `isNewCustomer` FLAG — and it is not the fraud
       case it looks like. Nothing can delete a ledger row while leaving the
       customer, so a flag cannot be farmed here. What a flag DOES do is deny a
       real customer their bonus: `perksMatch`, `credit` and `adjust` all create
       customer rows for phones that never signed up, so a customer who had a
       Perks match done at the counter is no longer "new" by the time they
       download the app, and a flag would silently withhold their 50.

       Reverting to `isNewCustomer && …` fails this test and nothing else,
       which is the honest description of what the key buys. */
    await ctx.petals.perksMatch({ name: NAME, phone: PHONE, petals: 80, staff: "Kay" });
    const r = await join(ctx.petals);
    expect(r.signupBonus, "joining after a counter match still earns it").toBe(SIGNUP_BONUS);
    expect(r.petals).toBe(80 + SIGNUP_BONUS);
  });

  it("is per phone number, so a different number is a different person", async () => {
    await join(ctx.petals);
    const other = await ctx.petals.claim({ name: "Someone Else", phone: FRIEND });
    expect(other.signupBonus).toBe(SIGNUP_BONUS);
  });
});

describe("claiming a counter receipt", () => {
  let ctx;
  beforeEach(async () => { ctx = setup(); await join(ctx.petals); });

  const claim = (orderId, petals = 22, over = {}) =>
    ctx.petals.claimReceipt({ name: NAME, phone: PHONE, orderId, petals, ...over });

  it("credits the order once", async () => {
    const r = await claim("ZQYKAKXNK8730", 25);
    expect(r.credited).toBe(25);
    expect(r.petals).toBe(SIGNUP_BONUS + 25);
  });

  it("refuses the same receipt a second time, from the same person", async () => {
    await claim("ZQYKAKXNK8730");
    await expect(claim("ZQYKAKXNK8730")).rejects.toMatchObject({ code: "ALREADY_CLAIMED" });
  });

  it("refuses a receipt somebody else already claimed, and credits nothing", async () => {
    /* THE ATTACK: two people photograph the same receipt off the counter. The
       key is the ORDER, with no customer in it, so the second one collides
       with the first one's row. Keyed on the customer — the obvious way to
       write it — both would be paid. */
    await claim("ZQYKAKXNK8730", 25);
    await ctx.petals.claim({ name: "Someone Else", phone: STRANGER });
    await expect(
      ctx.petals.claimReceipt({
        name: "Someone Else", phone: STRANGER, orderId: "ZQYKAKXNK8730", petals: 25 })
    ).rejects.toMatchObject({ code: "ALREADY_CLAIMED" });

    const theirs = await ctx.petals.balance({ name: "Someone Else", phone: STRANGER });
    expect(theirs.petals, "the second claimer got nothing").toBe(SIGNUP_BONUS);
  });

  it("rate-limits one phone to three receipts a day", async () => {
    /* THE ATTACK: someone works through a stack of receipts from the bin. Each
       one is a real, paid, unclaimed order, so every control above passes —
       the only thing standing in the way is the rate limit. */
    for (let i = 0; i < RECEIPT_CLAIMS_PER_DAY; i++) {
      expect((await claim(`ORDER${i}`, 22)).credited).toBe(22);
    }
    await expect(claim("ORDER-ONE-TOO-MANY")).rejects.toMatchObject({ code: "TOO_MANY_CLAIMS" });
  });

  it("lets the limit roll off after a day", async () => {
    for (let i = 0; i < RECEIPT_CLAIMS_PER_DAY; i++) await claim(`ORDER${i}`);
    ctx.tick(24 * 60 * 60 * 1000 + 1000);
    expect((await claim("ORDER-TOMORROW")).credited).toBe(22);
  });

  it("refuses a claim from a phone that never joined", async () => {
    await expect(ctx.petals.claimReceipt({
      name: "Nobody", phone: STRANGER, orderId: "X", petals: 10 })
    ).rejects.toMatchObject({ code: "NO_BALANCE" });
  });

  it("refuses a claim under the wrong name for that number", async () => {
    await expect(claim("ZQYKAKXNK8730", 22, { name: "Wrong Person" }))
      .rejects.toMatchObject({ code: "NAME_MISMATCH" });
  });
});

describe("reading an order id off a printed receipt", () => {
  it("maps only the four characters Clover's alphabet omits", () => {
    /* Clover ids are Crockford base32: 0123456789ABCDEFGHJKMNPQRSTVWXYZ, with
       I, L, O and U absent. Those four can be remapped with no ambiguity
       because they cannot appear. Q CAN, and mapping it — which a first draft
       of this did — corrupts every id containing one. Measured against 5,000
       live ids. */
    expect(normaliseOrderRef("o7q4")).toBe("07Q4");
    expect(normaliseOrderRef("IL")).toBe("11");
    expect(normaliseOrderRef("u")).toBe("V");
    expect(normaliseOrderRef("Q07Q4"), "Q is a real character").toBe("Q07Q4");
  });

  it("ignores spaces, dashes and case", () => {
    expect(normaliseOrderRef(" zqyk-akx nk8730 ")).toBe("ZQYKAKXNK8730");
  });
});

describe("the birthday reward", () => {
  it("pays during the birth month", async () => {
    const ctx = setup(JULY_2026);
    await join(ctx.petals, { birthday: "1990-07-04" });
    const r = await ctx.petals.birthdayReward({ name: NAME, phone: PHONE });
    expect(r.credited).toBe(BIRTHDAY_PETALS);
  });

  it("pays nothing in any other month", async () => {
    const ctx = setup(JULY_2026);
    await join(ctx.petals, { birthday: "1990-03-04" });
    const r = await ctx.petals.birthdayReward({ name: NAME, phone: PHONE });
    expect(r.credited).toBe(0);
    expect(r.reason).toBe("NOT_THIS_MONTH");
  });

  it("pays once per calendar year", async () => {
    const ctx = setup(JULY_2026);
    await join(ctx.petals, { birthday: "1990-07-04" });
    expect((await ctx.petals.birthdayReward({ name: NAME, phone: PHONE })).credited)
      .toBe(BIRTHDAY_PETALS);
    const again = await ctx.petals.birthdayReward({ name: NAME, phone: PHONE });
    expect(again.credited).toBe(0);
    expect(again.reason).toBe("ALREADY_THIS_YEAR");
  });

  it("does NOT pay again when the customer edits their birth date", async () => {
    /* THE ATTACK: claim in July, change the birthday to August, claim again.
       The key is phone + YEAR and deliberately contains no date, so the edit
       buys nothing. A key containing the date would mint one per edit. */
    const ctx = setup(JULY_2026);
    await join(ctx.petals, { birthday: "1990-07-04" });
    expect((await ctx.petals.birthdayReward({ name: NAME, phone: PHONE })).credited)
      .toBe(BIRTHDAY_PETALS);

    await join(ctx.petals, { birthday: "1990-08-04" });   // edit
    const aug = setup(Date.UTC(2026, 7, 10, 16, 0));
    const sameLedger = createPetals({ store: ctx.store, now: aug.at });
    const r = await sameLedger.birthdayReward({ name: NAME, phone: PHONE });
    expect(r.credited, "a changed date must not mint a second reward").toBe(0);
    expect(r.reason).toBe("ALREADY_THIS_YEAR");
  });

  it("pays again the following year", async () => {
    const ctx = setup(JULY_2026);
    await join(ctx.petals, { birthday: "1990-07-04" });
    await ctx.petals.birthdayReward({ name: NAME, phone: PHONE });
    const next = createPetals({ store: ctx.store, now: () => Date.UTC(2027, 6, 15, 16, 0) });
    expect((await next.birthdayReward({ name: NAME, phone: PHONE })).credited)
      .toBe(BIRTHDAY_PETALS);
  });

  it("is optional — no birth date means no reward and no error", async () => {
    const ctx = setup();
    await join(ctx.petals);
    const r = await ctx.petals.birthdayReward({ name: NAME, phone: PHONE });
    expect(r.credited).toBe(0);
    expect(r.reason).toBe("NO_BIRTHDAY");
  });

  it("stores month and day only, never the year", () => {
    expect(parseBirthday("1990-07-04")).toEqual({ month: 7, day: 4 });
    expect(parseBirthday("07-04")).toEqual({ month: 7, day: 4 });
  });

  it("refuses a date that does not exist", () => {
    expect(parseBirthday("1990-02-31")).toBeNull();
    expect(parseBirthday("1990-13-01")).toBeNull();
    expect(parseBirthday("nonsense")).toBeNull();
    // A leap day is legitimate, and the year is unknown, so it must be allowed.
    expect(parseBirthday("2000-02-29")).toEqual({ month: 2, day: 29 });
  });
});

describe("referrals", () => {
  const codeOf = async (petals) => (await join(petals)).referralCode;

  it("pays both sides when the friend's first order is PAID", async () => {
    const ctx = setup();
    const code = await codeOf(ctx.petals);
    await ctx.petals.claim({ name: "A Friend", phone: FRIEND, referralCode: code });

    await ctx.petals.credit({ name: "A Friend", phone: FRIEND, orderId: "O1", petals: 20 });

    const friend = await ctx.petals.balance({ name: "A Friend", phone: FRIEND });
    const me = await ctx.petals.balance({ name: NAME, phone: PHONE });
    expect(friend.petals).toBe(SIGNUP_BONUS + 20 + REFERRAL_BONUS);
    expect(me.petals).toBe(SIGNUP_BONUS + REFERRAL_BONUS);
  });

  it("pays NOTHING on order creation — only on payment", async () => {
    /* The rule that stops the whole scheme being farmed: place orders, never
       collect them, collect 100 Petals a time. openOrder must pay nobody. */
    const ctx = setup();
    const code = await codeOf(ctx.petals);
    await ctx.petals.claim({ name: "A Friend", phone: FRIEND, referralCode: code });

    await ctx.petals.openOrder({
      name: "A Friend", phone: FRIEND, orderId: "O1", earnable: 20 });

    const me = await ctx.petals.balance({ name: NAME, phone: PHONE });
    expect(me.petals, "no referral before the money is taken").toBe(SIGNUP_BONUS);
  });

  it("pays nothing when the friend's first order is voided", async () => {
    const ctx = setup();
    const code = await codeOf(ctx.petals);
    await ctx.petals.claim({ name: "A Friend", phone: FRIEND, referralCode: code });
    await ctx.petals.openOrder({
      name: "A Friend", phone: FRIEND, orderId: "O1", earnable: 20 });
    await ctx.petals.release("O1");

    const me = await ctx.petals.balance({ name: NAME, phone: PHONE });
    expect(me.petals).toBe(SIGNUP_BONUS);
  });

  it("pays the referrer once per friend, not once ever", async () => {
    /* Keyed on the REFEREE's phone. Keyed on the referrer's — the mistake that
       reads as "one referral bonus per customer" — this second friend pays
       nothing and the scheme stops working after one use. */
    const ctx = setup();
    const code = await codeOf(ctx.petals);
    for (const [n, ph] of [["Friend One", FRIEND], ["Friend Two", STRANGER]]) {
      await ctx.petals.claim({ name: n, phone: ph, referralCode: code });
      await ctx.petals.credit({ name: n, phone: ph, orderId: `O-${ph}`, petals: 10 });
    }
    const me = await ctx.petals.balance({ name: NAME, phone: PHONE });
    expect(me.petals).toBe(SIGNUP_BONUS + REFERRAL_BONUS * 2);
  });

  it("pays once per friend however many orders that friend pays for", async () => {
    const ctx = setup();
    const code = await codeOf(ctx.petals);
    await ctx.petals.claim({ name: "A Friend", phone: FRIEND, referralCode: code });
    for (const id of ["O1", "O2", "O3"]) {
      await ctx.petals.credit({ name: "A Friend", phone: FRIEND, orderId: id, petals: 10 });
    }
    const me = await ctx.petals.balance({ name: NAME, phone: PHONE });
    expect(me.petals).toBe(SIGNUP_BONUS + REFERRAL_BONUS);
  });

  it("refuses a customer referring themselves with their own code", async () => {
    const ctx = setup();
    const code = await codeOf(ctx.petals);
    const again = await ctx.petals.claim({ name: NAME, phone: PHONE, referralCode: code });
    expect(again.referralAccepted).toBe(false);
    await ctx.petals.credit({ name: NAME, phone: PHONE, orderId: "O1", petals: 10 });
    const me = await ctx.petals.balance({ name: NAME, phone: PHONE });
    expect(me.petals).toBe(SIGNUP_BONUS + 10);
  });

  it("cannot be applied to a customer who already exists", async () => {
    /* Two people who already eat here cannot start paying each other. The code
       is only read on a genuinely new customer row. */
    const ctx = setup();
    const code = await codeOf(ctx.petals);
    await ctx.petals.claim({ name: "A Friend", phone: FRIEND });        // joins with no code
    const later = await ctx.petals.claim({
      name: "A Friend", phone: FRIEND, referralCode: code });           // tries after the fact
    expect(later.referralAccepted).toBe(false);

    await ctx.petals.credit({ name: "A Friend", phone: FRIEND, orderId: "O1", petals: 10 });
    const me = await ctx.petals.balance({ name: NAME, phone: PHONE });
    expect(me.petals).toBe(SIGNUP_BONUS);
  });

  it("can only be referred once, ever", async () => {
    const ctx = setup();
    const mine = await codeOf(ctx.petals);
    const theirs = (await ctx.petals.claim({ name: "Third Party", phone: STRANGER })).referralCode;

    await ctx.petals.claim({ name: "A Friend", phone: FRIEND, referralCode: mine });
    const second = await ctx.petals.claim({
      name: "A Friend", phone: FRIEND, referralCode: theirs });
    expect(second.referralAccepted).toBe(false);

    await ctx.petals.credit({ name: "A Friend", phone: FRIEND, orderId: "O1", petals: 10 });
    const third = await ctx.petals.balance({ name: "Third Party", phone: STRANGER });
    expect(third.petals, "the second referrer must earn nothing").toBe(SIGNUP_BONUS);
  });

  it("ignores a code nobody owns", async () => {
    const ctx = setup();
    const r = await ctx.petals.claim({ name: "A Friend", phone: FRIEND, referralCode: "ZZZZZZ" });
    expect(r.referralAccepted).toBe(false);
    expect(r.signupBonus).toBe(SIGNUP_BONUS);
  });

  it("gives every customer a code that is not their phone number", async () => {
    const ctx = setup();
    const code = await codeOf(ctx.petals);
    expect(code).toMatch(/^[0-9BCDFGHJKMNPQRSTVWXYZ]{6}$/);
    expect(code).not.toContain("4757");
    // No vowels, so a code cannot spell a word at a counter.
    expect(code).not.toMatch(/[AEIOU]/);
  });
});

describe("the Perks balance match", () => {
  it("credits what staff typed, once", async () => {
    const ctx = setup();
    const r = await ctx.petals.perksMatch({ name: NAME, phone: PHONE, petals: 120, staff: "Kay" });
    expect(r.credited).toBe(120);
    expect(r.capped).toBe(false);
  });

  it("never exceeds the cap, whatever is typed", async () => {
    /* The cap is applied in the ledger, not in the UI, because a staff screen
       is not the only way to reach this — a request straight to the route
       bypasses every input attribute. */
    const ctx = setup();
    const r = await ctx.petals.perksMatch({ name: NAME, phone: PHONE, petals: 99999 });
    expect(r.credited).toBe(PERKS_MATCH_CAP);
    expect(r.capped).toBe(true);
    expect(r.asked).toBe(99999);
  });

  it("is once per phone number, ever", async () => {
    const ctx = setup();
    await ctx.petals.perksMatch({ name: NAME, phone: PHONE, petals: 200 });
    const again = await ctx.petals.perksMatch({ name: NAME, phone: PHONE, petals: 200 });
    expect(again.credited).toBe(0);
    expect(again.alreadyMatched).toBe(true);
    const bal = await ctx.petals.balance({ name: NAME, phone: PHONE });
    expect(bal.petals).toBe(PERKS_MATCH_CAP);
  });

  it("refuses a zero or negative match rather than writing a row", async () => {
    const ctx = setup();
    await expect(ctx.petals.perksMatch({ name: NAME, phone: PHONE, petals: 0 }))
      .rejects.toMatchObject({ code: "BAD_AMOUNT" });
    await expect(ctx.petals.perksMatch({ name: NAME, phone: PHONE, petals: -50 }))
      .rejects.toMatchObject({ code: "BAD_AMOUNT" });
  });

  it("records which staff member granted it", async () => {
    const ctx = setup();
    await ctx.petals.perksMatch({ name: NAME, phone: PHONE, petals: 50, staff: "Kay" });
    const rows = [];
    await ctx.store.tx(async (tx) => {
      const c = await tx.findCustomerByPhone("+14757776200");
      rows.push(await tx.findLedgerByIdemKey("perks:+14757776200"));
      expect(c).toBeTruthy();
    });
    expect(rows[0].reason).toContain("perks match");
    expect(rows[0].reason).toContain("Kay");
  });
});

describe("every credit is explainable afterwards", () => {
  it("writes a reason on each of the five, so a balance can be taken apart", async () => {
    /* The whole argument for a ledger instead of a column: "why is my balance
       this number" has to be answerable at a counter, months later. */
    const ctx = setup(JULY_2026);
    const code = (await join(ctx.petals, { birthday: "1990-07-04" })).referralCode;
    await ctx.petals.claimReceipt({ name: NAME, phone: PHONE, orderId: "R1", petals: 22 });
    await ctx.petals.birthdayReward({ name: NAME, phone: PHONE });
    await ctx.petals.perksMatch({ name: NAME, phone: PHONE, petals: 200 });
    await ctx.petals.claim({ name: "A Friend", phone: FRIEND, referralCode: code });
    await ctx.petals.credit({ name: "A Friend", phone: FRIEND, orderId: "O1", petals: 10 });

    const reasons = [];
    await ctx.store.tx(async (tx) => {
      const c = await tx.findCustomerByPhone("+14757776200");
      for (const key of [`signup:+14757776200`, `receipt:R1`, `birthday:+14757776200:2026`,
                         `perks:+14757776200`, `referral-referrer:+1${FRIEND}`]) {
        const row = await tx.findLedgerByIdemKey(key);
        reasons.push([key, row?.reason ?? null, row?.delta ?? null]);
        expect(row, `${key} should exist`).toBeTruthy();
        expect(row.customerId).toBe(c.id);
      }
    });
    expect(reasons.map((r) => r[1])).toEqual([
      "signup", "receipt", "birthday", "perks match", "referral",
    ]);
    const bal = await ctx.petals.balance({ name: NAME, phone: PHONE });
    expect(bal.petals).toBe(
      SIGNUP_BONUS + 22 + BIRTHDAY_PETALS + PERKS_MATCH_CAP + REFERRAL_BONUS);
  });
});
