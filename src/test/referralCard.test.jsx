import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import ReferralCard from "../components/ReferralCard.jsx";

/* ============================================================================
   THE REFERRAL CARD

   Everything here is a state a customer was previously shown NOTHING for. The
   referral pays on the friend's first paid order, which can be days after they
   sign up, so without these lines both sides see silence and then a balance
   that moves for no stated reason.
   ============================================================================ */

const status = (over = {}) => ({
  code: "K7M2X9", referred: false, canBeReferred: true,
  pendingIn: false, pendingOut: 0, ...over,
});

describe("the referral card", () => {
  it("shows the code and what it is worth", () => {
    render(<ReferralCard referral={status()} />);
    expect(screen.getByLabelText(/copy your referral code/i)).toHaveTextContent("K7M2X9");
    expect(screen.getByText(/100 Petals/i)).toBeInTheDocument();
    expect(screen.getByText(/5 friends a year/i)).toBeInTheDocument();
  });

  it("renders nothing at all without a status", () => {
    const { container } = render(<ReferralCard referral={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps the card and EXPLAINS itself when the server is unreachable", () => {
    /* The gap this closes: the code came from the claim response only, so the
       whole card vanished the moment a balance read failed. The balance
       already had a notice for that state; this now matches it. */
    render(<ReferralCard referral={status({ code: null })} available={false} />);
    expect(screen.getByText(/can't reach the kitchen/i)).toBeInTheDocument();
    expect(screen.getByText(/bring a friend/i)).toBeInTheDocument();
  });

  it("keeps showing a code it already knows, even when the balance is unavailable", () => {
    render(<ReferralCard referral={status()} available={false} />);
    expect(screen.getByLabelText(/copy your referral code/i)).toHaveTextContent("K7M2X9");
  });

  describe("pending, on the referrer's side", () => {
    it("says how many friends have not ordered yet", () => {
      render(<ReferralCard referral={status({ pendingOut: 2 })} />);
      expect(screen.getByRole("status"))
        .toHaveTextContent(/2 friends have your code and haven't ordered yet/i);
    });

    it("says it in the singular for one", () => {
      render(<ReferralCard referral={status({ pendingOut: 1 })} />);
      expect(screen.getByRole("status"))
        .toHaveTextContent(/1 friend has your code/i);
    });

    it("says nothing when nobody is pending", () => {
      render(<ReferralCard referral={status({ pendingOut: 0 })} />);
      expect(screen.queryByText(/haven't ordered yet/i)).toBeNull();
    });
  });

  describe("pending, on the referred customer's own side", () => {
    it("says 100 is waiting on their first order", () => {
      render(<ReferralCard referral={status({ referred: true, pendingIn: true, canBeReferred: false })} />);
      expect(screen.getByRole("status"))
        .toHaveTextContent(/once you've paid for your first order/i);
    });

    it("says it paid out once it has", () => {
      render(<ReferralCard referral={status({ referred: true, pendingIn: false, canBeReferred: false })} />);
      expect(screen.getByText(/paid out/i)).toBeInTheDocument();
    });
  });

  describe("entering a code they forgot at signup", () => {
    it("offers the field while the window is open", () => {
      render(<ReferralCard referral={status({ canBeReferred: true })} onEnterCode={vi.fn()} />);
      expect(screen.getByLabelText(/got a code from a friend/i)).toBeInTheDocument();
      expect(screen.getByText(/until your first order/i)).toBeInTheDocument();
    });

    it("hides the field once the window has closed", () => {
      render(<ReferralCard referral={status({ canBeReferred: false })} onEnterCode={vi.fn()} />);
      expect(screen.queryByLabelText(/got a code from a friend/i)).toBeNull();
    });

    it("sends a full code and confirms acceptance", async () => {
      const user = userEvent.setup();
      const onEnterCode = vi.fn().mockResolvedValue({ referralAccepted: true });
      render(<ReferralCard referral={status()} onEnterCode={onEnterCode} />);
      await user.type(screen.getByLabelText(/got a code/i), "a1b2c3");
      await user.click(screen.getByRole("button", { name: /^add$/i }));

      expect(onEnterCode).toHaveBeenCalledWith("A1B2C3");
      expect(await screen.findByText(/code accepted/i)).toBeInTheDocument();
    });

    it("will not send fewer than six characters", async () => {
      const user = userEvent.setup();
      const onEnterCode = vi.fn();
      render(<ReferralCard referral={status()} onEnterCode={onEnterCode} />);
      await user.type(screen.getByLabelText(/got a code/i), "A1B");
      expect(screen.getByRole("button", { name: /^add$/i })).toBeDisabled();
      await user.click(screen.getByRole("button", { name: /^add$/i }));
      expect(onEnterCode).not.toHaveBeenCalled();
    });

    it.each([
      ["UNKNOWN_CODE", /don't recognise that code/i],
      ["OWN_CODE", /your own code/i],
      ["ALREADY_REFERRED", /already a friend's code/i],
      ["WINDOW_CLOSED", /before your first order/i],
    ])("turns %s into something a customer can act on", async (reason, text) => {
      /* The whole point of item 2: a refusal used to be swallowed and the
         customer was told they were all set. */
      const user = userEvent.setup();
      const onEnterCode = vi.fn().mockResolvedValue({
        referralAccepted: false, referralRejected: reason });
      render(<ReferralCard referral={status()} onEnterCode={onEnterCode} />);
      await user.type(screen.getByLabelText(/got a code/i), "A1B2C3");
      await user.click(screen.getByRole("button", { name: /^add$/i }));
      expect(await screen.findByText(text)).toBeInTheDocument();
    });

    it("does not claim success for an unrecognised refusal", async () => {
      /* A reason string this build has never heard of must not read as
         accepted — an old client meeting a new server. */
      const user = userEvent.setup();
      const onEnterCode = vi.fn().mockResolvedValue({
        referralAccepted: false, referralRejected: "SOMETHING_NEW" });
      render(<ReferralCard referral={status()} onEnterCode={onEnterCode} />);
      await user.type(screen.getByLabelText(/got a code/i), "A1B2C3");
      await user.click(screen.getByRole("button", { name: /^add$/i }));
      expect(await screen.findByText(/didn't work/i)).toBeInTheDocument();
      expect(screen.queryByText(/accepted/i)).toBeNull();
    });

    it("keeps a rejected code in the field so it can be corrected", async () => {
      const user = userEvent.setup();
      const onEnterCode = vi.fn().mockResolvedValue({
        referralAccepted: false, referralRejected: "UNKNOWN_CODE" });
      render(<ReferralCard referral={status()} onEnterCode={onEnterCode} />);
      const field = screen.getByLabelText(/got a code/i);
      await user.type(field, "A1B2C3");
      await user.click(screen.getByRole("button", { name: /^add$/i }));
      await screen.findByText(/don't recognise/i);
      expect(field).toHaveValue("A1B2C3");
    });

    it("clears the field after acceptance", async () => {
      const user = userEvent.setup();
      render(<ReferralCard referral={status()}
        onEnterCode={vi.fn().mockResolvedValue({ referralAccepted: true })} />);
      const field = screen.getByLabelText(/got a code/i);
      await user.type(field, "A1B2C3");
      await user.click(screen.getByRole("button", { name: /^add$/i }));
      await waitFor(() => expect(field).toHaveValue(""));
    });
  });
});

/* ============================================================================
   THE ACKNOWLEDGEMENTS ON THE REWARDS SCREEN

   50 Petals used to appear on a new account with nothing to explain them, and
   350 more on a birthday. A customer cannot tell a gift from a bug, so an
   unexplained balance reads as a mistake and arrives at the counter as a
   complaint. Each is said once, under the number it changed.
   ============================================================================ */

import RewardsView from "../components/RewardsView.jsx";

const ACCOUNT = { name: "Nevaeh Reid", phone: "3478599413", since: "Sep 2026" };
const rewardsProps = (over = {}) => ({
  account: ACCOUNT, points: 50, petalsAvailable: true,
  vouchers: [], orders: [], redeem: vi.fn(), signOut: vi.fn(),
  referral: status(), ...over,
});

describe("saying what just landed", () => {
  it("explains the signup bonus", () => {
    render(<RewardsView {...rewardsProps({ signupBonus: 50 })} />);
    expect(screen.getByText(/50 Petals added for joining/i)).toBeInTheDocument();
  });

  it("says nothing when no bonus landed", () => {
    render(<RewardsView {...rewardsProps({ signupBonus: 0 })} />);
    expect(screen.queryByText(/added for joining/i)).toBeNull();
  });

  it("explains the birthday reward, and calls it a free plate", () => {
    render(<RewardsView {...rewardsProps({ birthdayPetals: 350 })} />);
    const note = screen.getByText(/happy birthday/i);
    expect(note).toBeInTheDocument();
    expect(note).toHaveTextContent(/350 Petals/);
    expect(note).toHaveTextContent(/free plate/i);
  });

  it("says nothing about a birthday in any other month", () => {
    render(<RewardsView {...rewardsProps({ birthdayPetals: 0 })} />);
    expect(screen.queryByText(/happy birthday/i)).toBeNull();
  });
});
