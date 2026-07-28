/* US phone entry. The customer types digits; we show (347) 859-9413.
   Formatting is applied on every keystroke, so it has to survive a partial
   number and a backspace through a separator. */

export const phoneDigits = (v) => String(v ?? "").replace(/\D/g, "").slice(0, 10);

/** Progressive: "3" -> "(3", "347859" -> "(347) 859" */
export function formatPhone(v) {
  const d = phoneDigits(v);
  if (d.length === 0) return "";
  if (d.length < 4) return `(${d}`;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export const isValidPhone = (v) => phoneDigits(v).length === 10;

/** Two characters is the shortest real name we should accept ("Jo", "Al"). */
export const isValidName = (v) => String(v ?? "").trim().length >= 2;
