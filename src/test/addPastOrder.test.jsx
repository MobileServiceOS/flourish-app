import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import AddPastOrder from "../components/AddPastOrder.jsx";

/* ============================================================================
   THE "ADD A PAST ORDER" FORM

   What is worth asserting here is mostly what this component does NOT do. Every
   real decision — paid, recent, unambiguous, unclaimed, within the rate limit —
   is the server's, and the temptation with a form like this is to reimplement
   some of that locally so the UI feels quicker. That would produce a second
   place where the rules live, and the two would drift.

   So: it sends what was typed, it shows what came back, and it does not invent
   a reason of its own.
   ============================================================================ */

const ok = (over = {}) => vi.fn().mockResolvedValue({ credited: 25, net: 25, ...over });

describe("adding a past order", () => {
  it("asks for the CLOVER ID, which is what a counter receipt prints", async () => {
    /* It used to say "order number from your receipt". This app calls FL-3412
       the order number in OrderDetail, so customers went looking for an FL
       number that no counter receipt carries, typed it, and were told the
       order did not exist. The receipt says "Clover ID"; so does this. */
    render(<AddPastOrder onClaim={ok()} />);
    expect(screen.getByLabelText(/clover id from your receipt/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/order number/i)).toBeNull();
    expect(screen.getByPlaceholderText(/4E3KNE/i), "the real last 6 of a real id")
      .toBeInTheDocument();
  });

  it("sends what was typed and reports what the server credited", async () => {
    const user = userEvent.setup();
    const onClaim = ok();
    render(<AddPastOrder onClaim={onClaim} />);

    await user.type(screen.getByLabelText(/clover id from your receipt/i), "k8730");
    await user.click(screen.getByRole("button", { name: /add/i }));

    expect(onClaim).toHaveBeenCalledWith("K8730");
    expect(await screen.findByRole("status")).toHaveTextContent(/25 Petals added/i);
  });

  it("strips spaces and dashes people read off a receipt", async () => {
    const user = userEvent.setup();
    const onClaim = ok();
    render(<AddPastOrder onClaim={onClaim} />);
    await user.type(screen.getByLabelText(/clover id/i), "k 87-30");
    await user.click(screen.getByRole("button", { name: /add/i }));
    expect(onClaim).toHaveBeenCalledWith("K8730");
  });

  it("keeps the letters Clover's alphabet never uses, for the server to fold", async () => {
    /* O, I, L and U cannot appear in a real id, so the server maps them back
       to 0, 1, 1 and V. Stripping them HERE would turn a recoverable typo into
       "not found", so they are passed through deliberately. */
    const user = userEvent.setup();
    const onClaim = ok();
    render(<AddPastOrder onClaim={onClaim} />);
    await user.type(screen.getByLabelText(/clover id/i), "OIIIO");
    await user.click(screen.getByRole("button", { name: /add/i }));
    expect(onClaim).toHaveBeenCalledWith("OIIIO");
  });

  it("will not send fewer than four characters", async () => {
    const user = userEvent.setup();
    const onClaim = ok();
    render(<AddPastOrder onClaim={onClaim} />);
    await user.type(screen.getByLabelText(/clover id/i), "873");
    expect(screen.getByRole("button", { name: /add/i })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /add/i }));
    expect(onClaim).not.toHaveBeenCalled();
  });

  it("shows the server's own wording when a claim is refused", async () => {
    /* "That order has already been added to an account" is written for someone
       standing at a counter holding the receipt. Replacing it with a generic
       failure here would throw away the only useful part of the answer. */
    const user = userEvent.setup();
    const onClaim = vi.fn().mockRejectedValue(
      new Error("That order has already been added to an account."));
    render(<AddPastOrder onClaim={onClaim} />);
    await user.type(screen.getByLabelText(/clover id/i), "K8730");
    await user.click(screen.getByRole("button", { name: /add/i }));
    expect(await screen.findByRole("status"))
      .toHaveTextContent(/already been added to an account/i);
  });

  it("does not decide for itself that an order is too old or unpaid", async () => {
    /* A stale-looking entry still goes to the server. The client has no way to
       know what the register says, and guessing would refuse real claims. */
    const user = userEvent.setup();
    const onClaim = ok();
    render(<AddPastOrder onClaim={onClaim} />);
    await user.type(screen.getByLabelText(/clover id/i), "000000");
    await user.click(screen.getByRole("button", { name: /add/i }));
    expect(onClaim).toHaveBeenCalledWith("000000");
  });

  it("clears the field after a success so the next receipt can be typed", async () => {
    const user = userEvent.setup();
    render(<AddPastOrder onClaim={ok()} />);
    const field = screen.getByLabelText(/clover id/i);
    await user.type(field, "K8730");
    await user.click(screen.getByRole("button", { name: /add/i }));
    await waitFor(() => expect(field).toHaveValue(""));
  });

  it("keeps what was typed after a failure, so it can be corrected", async () => {
    const user = userEvent.setup();
    const onClaim = vi.fn().mockRejectedValue(new Error("More than one order ends with those."));
    render(<AddPastOrder onClaim={onClaim} />);
    const field = screen.getByLabelText(/clover id/i);
    await user.type(field, "K8730");
    await user.click(screen.getByRole("button", { name: /add/i }));
    await screen.findByRole("status");
    expect(field, "retyping a receipt number is the worst possible response").toHaveValue("K8730");
  });

  it("disables the button while a claim is in flight", async () => {
    const user = userEvent.setup();
    let release;
    const onClaim = vi.fn(() => new Promise((r) => { release = () => r({ credited: 25, net: 25 }); }));
    render(<AddPastOrder onClaim={onClaim} />);
    await user.type(screen.getByLabelText(/clover id/i), "K8730");
    const button = screen.getByRole("button", { name: /add/i });
    await user.click(button);
    expect(button).toBeDisabled();
    release();
  });

  it("ignores a second submit that did not come from the button", async () => {
    /* The disabled button is the courtesy; THIS is the control. A form submits
       on Enter too, and the guard inside the handler is the only thing that
       stops a second request — which is why this fires the form directly
       rather than clicking. Written as a click first, it asserted nothing: a
       disabled button never fires, so removing the guard broke no test.

       Two requests for one receipt are harmless at the ledger, where the key
       stops the second. What the customer would see is their own claim coming
       back as "already added to an account", which reads as an accusation. */
    const user = userEvent.setup();
    let release;
    const onClaim = vi.fn(() => new Promise((r) => { release = () => r({ credited: 25, net: 25 }); }));
    const { container } = render(<AddPastOrder onClaim={onClaim} />);
    await user.type(screen.getByLabelText(/clover id/i), "K8730");

    const form = container.querySelector("form");
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(onClaim).toHaveBeenCalled());
    expect(onClaim).toHaveBeenCalledTimes(1);
    release();
  });

  it("is disabled, with a reason, when the balance cannot be reached", async () => {
    render(<AddPastOrder onClaim={ok()} disabled />);
    expect(screen.getByLabelText(/clover id/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /add/i })).toBeDisabled();
    expect(screen.getByText(/once your balance is reachable/i)).toBeInTheDocument();
  });
});
