import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStore } from "../../server/petals/store.memory.js";
import {
  createPetals, SIGNUP_BONUS, REFERRAL_BONUS, BIRTHDAY_PETALS,
} from "../../server/petals/ledger.js";

/* ============================================================================
   THE THINGS THE SCREENS NEED TO SAY

   Seven gaps were found by walking both flows as a customer rather than
   reading the intent, and every one of them was the server knowing something
   and never telling anybody:

     - a wrong referral code was accepted silently
     - a code could not be added after signup, and the loss was invisible
     - the 50-Petal signup bonus arrived unexplained
     - neither side of a referral saw it was pending
     - the code vanished whenever the balance read failed
     - the birthday was promised at signup and never paid

   So these tests are about the SHAPE OF THE ANSWER, not the arithmetic. The
   arithmetic is in petalsEarning.test.js. What is checked here is that the one
   place a screen can learn something actually carries it.
   ============================================================================ */

const NAME = "Nevaeh Reid";
const PHONE = "4757776200";
const FRIEND = "9175551234";
const JULY_2026 = Date.UTC(2026, 6, 15, 16, 0);

const setup = (at = JULY_2026) => {
  let clock = at;
  const store = createMemoryStore();
  return {
    store,
    petals: createPetals({ store, now: () => clock }),
    at: () => clock,
  };
};

describe("the referral status both reads carry", () => {
  let ctx;
  beforeEach(() => { ctx = setup(); });

  it("comes back from BALANCE, not only from claim", async () => {
    /* The bug this fixes: the code arrived on the claim response alone, so the
       Rewards card disappeared on every later refresh — and entirely whenever
       the first call of a launch happened to be a balance read. */
    const joined = await ctx.petals.claim({ name: NAME, phone: PHONE });
    expect(joined.referral.code).toMatch(/^[0-9BCDFGHJKMNPQRSTVWXYZ]{6}$/);

    const read = await ctx.petals.balance({ name: NAME, phone: PHONE });
    expect(read.referral.code, "the same code, from a plain balance read")
      .toBe(joined.referral.code);
  });

  it("reports the window as open for someone who has not ordered", async () => {
    const r = await ctx.petals.claim({ name: NAME, phone: PHONE });
    expect(r.referral).toMatchObject({ referred: false, canBeReferred: true });
  });

  it("closes the window once they have paid for something", async () => {
    await ctx.petals.claim({ name: NAME, phone: PHONE });
    await ctx.petals.credit({ name: NAME, phone: PHONE, orderId: "O1", petals: 20 });
    const r = await ctx.petals.balance({ name: NAME, phone: PHONE });
    expect(r.referral.canBeReferred).toBe(false);
  });

  it("counts a claimed counter receipt as having ordered", async () => {
    /* `receipt` is a paid order too — it closes the window exactly as an app
       order does, or someone could claim a receipt and then still be
       "referred" as a new customer. */
    await ctx.petals.claim({ name: NAME, phone: PHONE });
    await ctx.petals.claimReceipt({ name: NAME, phone: PHONE, orderId: "R1", petals: 22 });
    const r = await ctx.petals.balance({ name: NAME, phone: PHONE });
    expect(r.referral.canBeReferred).toBe(false);
  });

  it("shows a referrer how many friends have not ordered yet", async () => {
    const code = (await ctx.petals.claim({ name: NAME, phone: PHONE })).referral.code;
    await ctx.petals.claim({ name: "One", phone: FRIEND, referralCode: code });
    await ctx.petals.claim({ name: "Two", phone: "2125559999", referralCode: code });

    let mine = await ctx.petals.balance({ name: NAME, phone: PHONE });
    expect(mine.referral.pendingOut, "two friends, neither has paid").toBe(2);

    await ctx.petals.credit({ name: "One", phone: FRIEND, orderId: "O1", petals: 10 });
    mine = await ctx.petals.balance({ name: NAME, phone: PHONE });
    expect(mine.referral.pendingOut, "one paid, one still pending").toBe(1);
  });

  it("shows a referred customer that 100 is waiting on their own first order", async () => {
    const code = (await ctx.petals.claim({ name: NAME, phone: PHONE })).referral.code;
    await ctx.petals.claim({ name: "One", phone: FRIEND, referralCode: code });

    let theirs = await ctx.petals.balance({ name: "One", phone: FRIEND });
    expect(theirs.referral).toMatchObject({ referred: true, pendingIn: true });

    await ctx.petals.credit({ name: "One", phone: FRIEND, orderId: "O1", petals: 10 });
    theirs = await ctx.petals.balance({ name: "One", phone: FRIEND });
    expect(theirs.referral.pendingIn, "paid out, no longer pending").toBe(false);
    expect(theirs.referral.referred).toBe(true);
  });

  it("never reveals who a code belongs to", async () => {
    /* The status is rendered on a customer's own screen, so it must not carry
       anybody else's name, number or id. */
    const code = (await ctx.petals.claim({ name: NAME, phone: PHONE })).referral.code;
    await ctx.petals.claim({ name: "One", phone: FRIEND, referralCode: code });
    const theirs = await ctx.petals.balance({ name: "One", phone: FRIEND });
    const json = JSON.stringify(theirs);
    expect(json).not.toContain(PHONE);
    expect(json).not.toContain("Nevaeh");
  });
});

describe("checking a code before an account exists", () => {
  let ctx;
  beforeEach(() => { ctx = setup(); });

  it("accepts a real code for a phone with no account yet", async () => {
    const code = (await ctx.petals.claim({ name: NAME, phone: PHONE })).referral.code;
    expect(await ctx.petals.referralCheck({ phone: FRIEND, code })).toEqual({ valid: true });
  });

  it("rejects a code nobody owns, so the typo is fixable on the form", async () => {
    expect(await ctx.petals.referralCheck({ phone: FRIEND, code: "ZZZZZZ" }))
      .toMatchObject({ valid: false, reason: "UNKNOWN_CODE" });
  });

  it("rejects the customer's own code", async () => {
    const code = (await ctx.petals.claim({ name: NAME, phone: PHONE })).referral.code;
    expect(await ctx.petals.referralCheck({ phone: PHONE, code }))
      .toMatchObject({ valid: false, reason: "OWN_CODE" });
  });

  it("rejects a code for someone who already has one", async () => {
    const code = (await ctx.petals.claim({ name: NAME, phone: PHONE })).referral.code;
    await ctx.petals.claim({ name: "One", phone: FRIEND, referralCode: code });
    const other = (await ctx.petals.claim({ name: "X", phone: "2125559999" })).referral.code;
    expect(await ctx.petals.referralCheck({ phone: FRIEND, code: other }))
      .toMatchObject({ valid: false, reason: "ALREADY_REFERRED" });
  });

  it("rejects a code once the customer has paid for something", async () => {
    const code = (await ctx.petals.claim({ name: NAME, phone: PHONE })).referral.code;
    await ctx.petals.claim({ name: "One", phone: FRIEND });
    await ctx.petals.credit({ name: "One", phone: FRIEND, orderId: "O1", petals: 10 });
    expect(await ctx.petals.referralCheck({ phone: FRIEND, code }))
      .toMatchObject({ valid: false, reason: "WINDOW_CLOSED" });
  });

  it("WRITES NOTHING — it is a question, not a claim", async () => {
    /* It runs before an account exists, so it must not create one. A check
       that enrolled the customer would hand out a signup bonus to anyone who
       typed a code and then abandoned the form. */
    const code = (await ctx.petals.claim({ name: NAME, phone: PHONE })).referral.code;
    const before = ctx.store.__rows
      ? { c: ctx.store.__rows.customers.length, l: ctx.store.__rows.ledger.length }
      : null;
    await ctx.petals.referralCheck({ phone: FRIEND, code });
    await ctx.petals.referralCheck({ phone: FRIEND, code: "ZZZZZZ" });
    if (before) {
      expect(ctx.store.__rows.customers).toHaveLength(before.c);
      expect(ctx.store.__rows.ledger).toHaveLength(before.l);
    }
    const friend = await ctx.petals.balance({ name: "One", phone: FRIEND });
    expect(friend.known, "no account was created by asking").toBe(false);
  });

  it("says nothing useful about an empty code rather than throwing", async () => {
    expect(await ctx.petals.referralCheck({ phone: FRIEND, code: "" }))
      .toMatchObject({ valid: false, reason: "EMPTY" });
  });
});

describe("the birthday, end to end", () => {
  it("is reported on the balance so the client knows the month", async () => {
    /* The client only asks for a birthday reward in the right month, and this
       is how it learns which month that is. Without it the app would either
       ask twelve times a year or never. */
    const ctx = setup(JULY_2026);
    await ctx.petals.claim({ name: NAME, phone: PHONE, birthday: "1990-07-04" });
    const r = await ctx.petals.balance({ name: NAME, phone: PHONE });
    expect(r.birthday).toEqual({ month: 7, day: 4 });
  });

  it("still reports no birthday for a customer who gave none", async () => {
    const ctx = setup();
    await ctx.petals.claim({ name: NAME, phone: PHONE });
    expect((await ctx.petals.balance({ name: NAME, phone: PHONE })).birthday).toBeNull();
  });

  it("never reports a year, because none was stored", async () => {
    const ctx = setup(JULY_2026);
    await ctx.petals.claim({ name: NAME, phone: PHONE, birthday: "1990-07-04" });
    const r = await ctx.petals.balance({ name: NAME, phone: PHONE });
    expect(JSON.stringify(r.birthday)).not.toContain("1990");
    expect(Object.keys(r.birthday).sort()).toEqual(["day", "month"]);
  });

  it("pays the reward, and the balance reflects it afterwards", async () => {
    const ctx = setup(JULY_2026);
    await ctx.petals.claim({ name: NAME, phone: PHONE, birthday: "1990-07-04" });
    const paid = await ctx.petals.birthdayReward({ name: NAME, phone: PHONE });
    expect(paid.credited).toBe(BIRTHDAY_PETALS);
    const after = await ctx.petals.balance({ name: NAME, phone: PHONE });
    expect(after.petals).toBe(SIGNUP_BONUS + BIRTHDAY_PETALS);
  });
});

describe("the signup bonus is reported, not just paid", () => {
  it("says how much landed, so the screen can explain the number", async () => {
    const ctx = setup();
    const r = await ctx.petals.claim({ name: NAME, phone: PHONE });
    expect(r.signupBonus).toBe(SIGNUP_BONUS);
  });

  it("says zero on every later read, so it is announced once", async () => {
    const ctx = setup();
    await ctx.petals.claim({ name: NAME, phone: PHONE });
    expect((await ctx.petals.claim({ name: NAME, phone: PHONE })).signupBonus).toBe(0);
    expect((await ctx.petals.balance({ name: NAME, phone: PHONE })).signupBonus)
      .toBeUndefined();
  });
});
