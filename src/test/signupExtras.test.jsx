import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
