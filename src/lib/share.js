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
