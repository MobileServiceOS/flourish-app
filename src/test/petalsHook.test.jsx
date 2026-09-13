import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

/* ============================================================================
   usePetalsBalance — THE THREE THINGS THAT ONLY LIVE IN THE HOOK

   Found by reverting each of them and watching nothing fail:

     1. the birthday reward is CLAIMED here, automatically, on the first launch
        in the customer's birth month. Nothing else in the app calls that
        endpoint — the reward was promised at signup and no code fulfilled it.
     2. it must NOT ask in the other eleven months.
     3. the referral status and birthday survive a failed read. Blanking them
        made the code card vanish the moment the server was unreachable, which
        is the same mistake the balance already had a notice for.

   Mocked at the module boundary, because the point is which calls are made
   and what is kept between them.
   ============================================================================ */

const getPetalsBalance = vi.fn();
const claimPetals = vi.fn();
const claimBirthday = vi.fn();

vi.mock("../lib/clover.js", () => ({
  getPetalsBalance: (...a) => getPetalsBalance(...a),
  claimPetals: (...a) => claimPetals(...a),
  claimBirthday: (...a) => claimBirthday(...a),
  claimReceipt: vi.fn(),
  checkReferralCode: vi.fn(),
  getOrder: vi.fn(),
  getOrderStatus: vi.fn(),
  createOrder: vi.fn(),
  syncCustomer: vi.fn(),
  setStock: vi.fn(),
  printTest: vi.fn(),
  quote: vi.fn(),
  health: vi.fn(),
  getRewards: vi.fn(),
  getLoyalty: vi.fn(),
  markReady: vi.fn(),
  getInventory: vi.fn(),
  pay: vi.fn(),
}));

const { usePetalsBalance } = await import("../hooks/clover.js");

const WHO = { name: "Nevaeh Reid", phone: "3478599413" };
const STATUS = { code: "K7M2X9", referred: false, canBeReferred: true, pendingIn: false, pendingOut: 0 };

/** A fixed "today", so a birth month is a decision and not the wall clock. */
const freezeMonth = (month) => {
  /* shouldAdvanceTime, or waitFor hangs: it polls on real timers, and freezing
     them entirely is what made the first draft of this file time out at
     exactly 20s in every test — the same signature as TECH-DEBT #4. */
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, month - 1, 15, 12, 0));
};

beforeEach(() => {
  getPetalsBalance.mockReset();
  claimPetals.mockReset();
  claimBirthday.mockReset();
});
afterEach(() => { vi.useRealTimers(); });

describe("the birthday reward is claimed by the hook", () => {
  it("asks in the customer's birth month, and re-reads the balance after", async () => {
    freezeMonth(7);
    claimPetals.mockResolvedValue({
      petals: 50, known: true, referral: STATUS, birthday: { month: 7, day: 4 } });
    claimBirthday.mockResolvedValue({ credited: 350 });
    getPetalsBalance.mockResolvedValue({
      petals: 400, known: true, referral: STATUS, birthday: { month: 7, day: 4 } });

    const { result } = renderHook(() => usePetalsBalance(WHO));

    await waitFor(() => expect(claimBirthday).toHaveBeenCalledTimes(1));
    expect(claimBirthday).toHaveBeenCalledWith(
      expect.objectContaining({ phone: WHO.phone }), expect.anything());

    /* The balance set from the claim predates the birthday credit, so it is
       re-read rather than having 350 added locally — the server's number is
       the one that counts, and it may have paid a referral in the same window. */
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    await waitFor(() => expect(result.current.petals).toBe(400));
    expect(result.current.birthdayPetals).toBe(350);
  });

  it("does NOT ask in any other month", async () => {
    freezeMonth(3);
    claimPetals.mockResolvedValue({
      petals: 50, known: true, referral: STATUS, birthday: { month: 7, day: 4 } });

    renderHook(() => usePetalsBalance(WHO));
    await waitFor(() => expect(claimPetals).toHaveBeenCalled());
    expect(claimBirthday, "eleven months of pointless requests").not.toHaveBeenCalled();
  });

  it("does not ask at all for a customer who gave no birth date", async () => {
    freezeMonth(7);
    claimPetals.mockResolvedValue({
      petals: 50, known: true, referral: STATUS, birthday: null });

    renderHook(() => usePetalsBalance(WHO));
    await waitFor(() => expect(claimPetals).toHaveBeenCalled());
    expect(claimBirthday).not.toHaveBeenCalled();
  });

  it("asks once per launch, not once per balance read", async () => {
    freezeMonth(7);
    claimPetals.mockResolvedValue({
      petals: 50, known: true, referral: STATUS, birthday: { month: 7, day: 4 } });
    claimBirthday.mockResolvedValue({ credited: 0 });
    getPetalsBalance.mockResolvedValue({
      petals: 50, known: true, referral: STATUS, birthday: { month: 7, day: 4 } });

    const { result } = renderHook(() => usePetalsBalance(WHO));
    await waitFor(() => expect(claimBirthday).toHaveBeenCalledTimes(1));
    await act(async () => { result.current.refresh(); });
    await act(async () => { result.current.refresh(); });
    expect(claimBirthday).toHaveBeenCalledTimes(1);
  });

  it("never fails a balance read because the birthday call threw", async () => {
    freezeMonth(7);
    claimPetals.mockResolvedValue({
      petals: 50, known: true, referral: STATUS, birthday: { month: 7, day: 4 } });
    claimBirthday.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => usePetalsBalance(WHO));
    await waitFor(() => expect(result.current.available).toBe(true));
    expect(result.current.petals).toBe(50);
  });
});

describe("what survives a failed read", () => {
  it("KEEPS the referral status and birthday when the server goes away", async () => {
    /* The card used to disappear entirely. A customer's own code does not
       change, so throwing it away on a network failure is strictly worse than
       showing it with the balance marked unavailable — which is exactly how
       the balance itself already behaved. */
    freezeMonth(3);
    claimPetals.mockResolvedValue({
      petals: 120, known: true, referral: STATUS, birthday: { month: 7, day: 4 } });

    const { result } = renderHook(() => usePetalsBalance(WHO));
    await waitFor(() => expect(result.current.referral).toEqual(STATUS));

    getPetalsBalance.mockRejectedValue(new Error("offline"));
    await act(async () => { result.current.refresh(); });

    await waitFor(() => expect(result.current.available).toBe(false));
    expect(result.current.petals, "the balance itself is unknown").toBeNull();
    expect(result.current.referral, "the code is kept").toEqual(STATUS);
    expect(result.current.birthday).toEqual({ month: 7, day: 4 });
  });

  it("clears everything when the customer signs out", async () => {
    /* Signing out is not a failure — the next person to use this phone must
       not see the last one's code. */
    freezeMonth(3);
    claimPetals.mockResolvedValue({
      petals: 120, known: true, referral: STATUS, birthday: { month: 7, day: 4 } });

    const { result, rerender } = renderHook(
      ({ who }) => usePetalsBalance(who), { initialProps: { who: WHO } });
    await waitFor(() => expect(result.current.referral).toEqual(STATUS));

    rerender({ who: { name: undefined, phone: undefined } });
    await waitFor(() => expect(result.current.referral).toBeNull());
    expect(result.current.birthday).toBeNull();
  });
});

describe("the signup bonus reaches the screen", () => {
  it("reports what landed so it can be announced", async () => {
    freezeMonth(3);
    claimPetals.mockResolvedValue({
      petals: 50, known: true, signupBonus: 50, referral: STATUS, birthday: null });

    const { result } = renderHook(() => usePetalsBalance(WHO));
    await waitFor(() => expect(result.current.signupBonus).toBe(50));
  });
});
