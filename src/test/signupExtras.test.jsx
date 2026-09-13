import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import SignInView from "../components/SignInView.jsx";
import { shareCode } from "../lib/share.js";

/* ============================================================================
   THE OPTIONAL HALF OF SIGNING UP

   A birth date and a friend's referral code. Both optional, and the reason that
   matters: a required field costs signups, so neither may ever block the
   button. Most of what follows checks that they stay out of the way.

   The birth date is also the one piece of genuinely sensitive data this app has
   ever asked for, and the design decision is that it does NOT ask for it: month
   and day are two selects with no year anywhere, so there is no year to leak,
   no year to store, and no year a future change could start sending by
   accident. A `<input type="date">` would have been fewer lines and would have
   put a date of birth in the form.
   ============================================================================ */

const fill = async (user) => {
  await user.type(screen.getByLabelText(/full name/i), "Nevaeh Reid");
  await user.type(screen.getByLabelText(/phone number/i), "3478599413");
};

describe("signing up with the optional fields", () => {
  it("creates an account with neither of them filled in", async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn();
    render(<SignInView onSignIn={onSignIn} />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: /create my account/i }));

    expect(onSignIn).toHaveBeenCalledWith("Nevaeh Reid", "3478599413",
      { birthday: undefined, referralCode: undefined });
  });

  it("never offers anywhere to type a year", () => {
    /* The whole point. Two selects, month and day. A date input would collect a
       birth year the shop has no use for and no business holding. */
    render(<SignInView onSignIn={vi.fn()} />);
    expect(screen.getByLabelText(/birth month/i).tagName).toBe("SELECT");
    expect(screen.getByLabelText(/birth day/i).tagName).toBe("SELECT");
    expect(document.querySelector('input[type="date"]')).toBeNull();
    expect(document.querySelector('input[type="number"]')).toBeNull();
  });

  it("sends month and day, and nothing else", async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn();
    render(<SignInView onSignIn={onSignIn} />);
    await fill(user);
    await user.selectOptions(screen.getByLabelText(/birth month/i), "7");
    await user.selectOptions(screen.getByLabelText(/birth day/i), "4");
    await user.click(screen.getByRole("button", { name: /create my account/i }));

    const [, , extras] = onSignIn.mock.calls[0];
    expect(extras.birthday).toBe("7-4");
    expect(extras.birthday).not.toMatch(/\d{4}/);
  });

  it("sends nothing when only half a date is chosen", async () => {
    /* A month with no day is not a date. Sending "7-" would be refused by the
       server, which would turn an optional field into a blocked signup. */
    const user = userEvent.setup();
    const onSignIn = vi.fn();
    render(<SignInView onSignIn={onSignIn} />);
    await fill(user);
    await user.selectOptions(screen.getByLabelText(/birth month/i), "7");
    await user.click(screen.getByRole("button", { name: /create my account/i }));

    expect(onSignIn.mock.calls[0][2].birthday).toBeUndefined();
  });

  it("offers 29 days in February, because the year is unknown", async () => {
    const user = userEvent.setup();
    render(<SignInView onSignIn={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText(/birth month/i), "2");
    const days = [...screen.getByLabelText(/birth day/i).querySelectorAll("option")]
      .map((o) => o.value).filter(Boolean);
    expect(days).toHaveLength(29);
    expect(days.at(-1)).toBe("29");
  });

  it("does not offer 31 days in a 30-day month", async () => {
    const user = userEvent.setup();
    render(<SignInView onSignIn={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText(/birth month/i), "4");   // April
    const days = [...screen.getByLabelText(/birth day/i).querySelectorAll("option")]
      .map((o) => o.value).filter(Boolean);
    expect(days).toHaveLength(30);
  });

  it("passes a referral code up, uppercased and stripped", async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn();
    render(<SignInView onSignIn={onSignIn} />);
    await fill(user);
    await user.type(screen.getByLabelText(/referral code/i), "k7m-2x9");
    await user.click(screen.getByRole("button", { name: /create my account/i }));

    expect(onSignIn.mock.calls[0][2].referralCode).toBe("K7M2X9");
  });

  it("will not take more than a code's worth of characters", async () => {
    const user = userEvent.setup();
    render(<SignInView onSignIn={vi.fn()} />);
    await user.type(screen.getByLabelText(/referral code/i), "ABCDEFGHIJKLMNOP");
    expect(screen.getByLabelText(/referral code/i)).toHaveValue("ABCDEF");
  });

  it("never blocks the button on either optional field", async () => {
    const user = userEvent.setup();
    render(<SignInView onSignIn={vi.fn()} />);
    const button = screen.getByRole("button", { name: /create my account|enter your/i });
    await fill(user);
    expect(button).toBeEnabled();
    await user.type(screen.getByLabelText(/referral code/i), "Z");   // nonsense, half a code
    await user.selectOptions(screen.getByLabelText(/birth month/i), "2");
    expect(button, "an optional field must never stop someone joining").toBeEnabled();
  });
});

describe("sharing a referral code", () => {
  it("shares the code and a line of text, never a link that pretends to work", async () => {
    /* No URL applies a code — the friend types it into the signup field — so a
       link here would look like one-tap enrolment and do nothing. */
    const share = vi.fn().mockResolvedValue(undefined);
    const out = await shareCode("K7M2X9", { share });
    expect(out).toBe("shared");
    const { text, url } = share.mock.calls[0][0];
    expect(text).toContain("K7M2X9");
    expect(url, "no url, because none would work").toBeUndefined();
  });

  it("puts only the code on the clipboard when there is no share sheet", async () => {
    /* Someone tapping this is usually mid-message. Pasting a whole paragraph
       into that is worse than pasting six characters. */
    const writeText = vi.fn().mockResolvedValue(undefined);
    const out = await shareCode("K7M2X9", { clipboard: { writeText } });
    expect(out).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("K7M2X9");
  });

  it("says nothing happened when the customer backs out of the share sheet", async () => {
    const share = vi.fn().mockRejectedValue(
      Object.assign(new Error("cancelled"), { name: "AbortError" }));
    expect(await shareCode("K7M2X9", { share })).toBeNull();
  });
});

/* ============================================================================
   THE CONVERSION MOMENT, AND CORRECTING A CODE BEFORE IT IS TOO LATE
   ============================================================================ */

describe("what the signup screen offers a walk-in", () => {
  it("names the receipt they are holding", () => {
    /* A walk-in with a receipt is who the claim feature is FOR, and they could
       not see it: "Add a past order" lives on Rewards, which only exists once
       an account does. The form never mentioned the money already spent. */
    render(<SignInView onSignIn={vi.fn()} />);
    expect(screen.getByText(/ordered at the counter/i)).toBeInTheDocument();
    expect(screen.getByText(/your receipt is worth/i)).toBeInTheDocument();
    expect(screen.getByText(/clover id/i)).toBeInTheDocument();
  });

  it("says the joining bonus out loud", () => {
    /* 50 Petals were being paid and never mentioned — a reason to sign up
       thrown away, and then an unexplained balance. */
    render(<SignInView onSignIn={vi.fn()} />);
    expect(screen.getByText(/50 Petals just for joining/i)).toBeInTheDocument();
  });
});

describe("correcting a referral code before the account exists", () => {
  const fillForm = async (user) => {
    await user.type(screen.getByLabelText(/full name/i), "Nevaeh Reid");
    await user.type(screen.getByLabelText(/phone number/i), "3478599413");
  };

  it("confirms a good code on blur", async () => {
    const user = userEvent.setup();
    const onCheckCode = vi.fn().mockResolvedValue({ valid: true });
    render(<SignInView onSignIn={vi.fn()} onCheckCode={onCheckCode} />);
    await fillForm(user);
    await user.type(screen.getByLabelText(/referral code/i), "K7M2X9");
    await user.tab();

    expect(onCheckCode).toHaveBeenCalledWith({ phone: "3478599413", code: "K7M2X9" });
    expect(await screen.findByText(/code looks good/i)).toBeInTheDocument();
  });

  it.each([
    ["UNKNOWN_CODE", /don't recognise that code/i],
    ["OWN_CODE", /can't refer yourself/i],
    ["ALREADY_REFERRED", /already a friend's code/i],
    ["WINDOW_CLOSED", /before your first order/i],
  ])("shows %s as something fixable, before signing up", async (reason, text) => {
    /* THE POINT: correctable HERE. Once the account exists and has ordered,
       nothing in the app can apply a code, so a refusal discovered later is a
       refusal discovered never. */
    const user = userEvent.setup();
    render(<SignInView onSignIn={vi.fn()}
      onCheckCode={vi.fn().mockResolvedValue({ valid: false, reason })} />);
    await fillForm(user);
    await user.type(screen.getByLabelText(/referral code/i), "ZZZZZZ");
    await user.tab();
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it("still lets them sign up with a bad code rather than trapping them", async () => {
    /* An optional field must never block joining. The code is sent anyway and
       the claim decides; what changed is that they were TOLD. */
    const user = userEvent.setup();
    const onSignIn = vi.fn();
    render(<SignInView onSignIn={onSignIn}
      onCheckCode={vi.fn().mockResolvedValue({ valid: false, reason: "UNKNOWN_CODE" })} />);
    await fillForm(user);
    await user.type(screen.getByLabelText(/referral code/i), "ZZZZZZ");
    await user.tab();
    await screen.findByText(/don't recognise/i);

    const button = screen.getByRole("button", { name: /create my account/i });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onSignIn).toHaveBeenCalled();
  });

  it("clears the verdict as soon as the code is edited", async () => {
    const user = userEvent.setup();
    render(<SignInView onSignIn={vi.fn()}
      onCheckCode={vi.fn().mockResolvedValue({ valid: false, reason: "UNKNOWN_CODE" })} />);
    await fillForm(user);
    await user.type(screen.getByLabelText(/referral code/i), "ZZZZZZ");
    await user.tab();
    await screen.findByText(/don't recognise/i);
    await user.type(screen.getByLabelText(/referral code/i), "1");
    expect(screen.queryByText(/don't recognise/i)).toBeNull();
  });

  it("says nothing about the code when the server cannot be reached", async () => {
    /* Accusing a code because the network failed is worse than silence: the
       claim will decide, and a customer who retypes a correct code is being
       sent in circles. */
    const user = userEvent.setup();
    render(<SignInView onSignIn={vi.fn()}
      onCheckCode={vi.fn().mockRejectedValue(new Error("offline"))} />);
    await fillForm(user);
    await user.type(screen.getByLabelText(/referral code/i), "K7M2X9");
    await user.tab();
    await waitFor(() =>
      expect(screen.queryByText(/checking that code/i)).toBeNull());
    expect(screen.queryByText(/don't recognise/i)).toBeNull();
    expect(screen.getByText(/got a code from a friend/i)).toBeInTheDocument();
  });

  it("does not ask the server about an empty field", async () => {
    const user = userEvent.setup();
    const onCheckCode = vi.fn();
    render(<SignInView onSignIn={vi.fn()} onCheckCode={onCheckCode} />);
    await user.click(screen.getByLabelText(/referral code/i));
    await user.tab();
    expect(onCheckCode).not.toHaveBeenCalled();
  });
});
