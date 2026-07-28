import { screen, within } from "@testing-library/react";

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
