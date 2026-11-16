/** Format a US phone number for display — shared by the app (front-end/lib/format.ts) and the
 *  backend (REQ-836: the demo stage's label for a customer with no name yet, as /admin writes it).
 *  - "+15125550000" → "(512) 555-0000"
 *  - "5125550000"   → "(512) 555-0000"
 *  - non-NANP / unparseable: returns the input unchanged (still readable). */
export function fmtPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  // Strip a leading 1 country code if present.
  const usDigits = digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;
  if (usDigits.length === 10) {
    return `(${usDigits.slice(0, 3)}) ${usDigits.slice(3, 6)}-${
      usDigits.slice(6)
    }`;
  }
  return raw;
}
