/* Sharing Flourish. Native share sheet on a phone, clipboard on desktop. */
export const SHARE_URL = "https://flourishbx.com";
export const SHARE_TEXT =
  "Order pickup from Flourish BX — real Caribbean food, no delivery app markup. " + SHARE_URL;

/* Resolves to what actually happened so the button can say so; a cancelled
   share sheet throws AbortError and should leave the label alone. */
export async function shareFlourish(nav = globalThis.navigator) {
  try {
    if (nav?.share) {
      await nav.share({ title: "Flourish BX", text: SHARE_TEXT, url: SHARE_URL });
      return "shared";
    }
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(SHARE_TEXT);
      return "copied";
    }
  } catch (e) {
    if (e?.name === "AbortError") return null;   // customer backed out
  }
  return null;
}

/**
 * Share a customer's referral code.
 *
 * Deliberately shares the CODE and a line of text, not a deep link. There is no
 * link that applies a code — the friend types it into the signup field — so a
 * URL here would look like one-tap enrolment and silently do nothing. Promising
 * less and working is better than the reverse.
 */
export async function shareCode(code, nav = globalThis.navigator) {
  const text =
    `Use my code ${code} when you join Flourish Rewards and we both get 100 Petals. `
    + SHARE_URL;
  try {
    if (nav?.share) {
      await nav.share({ title: "Flourish BX", text });
      return "shared";
    }
    if (nav?.clipboard?.writeText) {
      /* The CODE alone on the clipboard, not the sentence: someone tapping
         this is usually about to paste it into a message they are already
         writing, and pasting a whole paragraph into that is worse. */
      await nav.clipboard.writeText(code);
      return "copied";
    }
  } catch (e) {
    if (e?.name === "AbortError") return null;
  }
  return null;
}
