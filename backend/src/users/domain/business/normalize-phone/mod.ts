/**
 * Normalize a phone string into E.164 form (e.g., "+15125551234").
 *
 * Accepts: "(512) 555-1234", "512-555-1234", "5125551234", "+1 512 555 1234".
 * Defaults the country code to "+1" (US/CA) when 10 digits are supplied.
 * Throws when the result isn't a plausible 11-15 digit international number.
 */
/**
 * REQ-030 (NW-25): a fictional US/CA number — NANP area code 555 (not
 * assignable) or the reserved fictional block 555-01XX. Twilio rejects these
 * with 21211; the customer SMS send path says so before dialling. The rest
 * of the 555 exchange is deliberately NOT flagged: real 555-XXXX lines
 * outside 01XX exist — Twilio's own 21211 is mapped and surfaced for those.
 *
 * `normalizePhone` (the login/OTP path) does NOT apply this: dev and test
 * personas log in with 555 numbers under the master OTP, and a real login
 * attempt on such a number already fails honestly at the provider.
 */
export function isFictionalUsNumber(e164: string): boolean {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (!m) return false;
  const [, area, exchange, line] = m;
  return area === "555" || (exchange === "555" && line.startsWith("01"));
}

export function normalizePhone(input: string): string {
  if (typeof input !== "string") throw new Error("phone must be a string");
  const trimmed = input.trim();
  const hadPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 0) throw new Error("phone has no digits");

  let normalized: string;
  if (hadPlus) {
    if (digits.length < 8 || digits.length > 15) {
      throw new Error(`phone has invalid length: ${digits.length}`);
    }
    normalized = `+${digits}`;
  } else if (digits.length === 10) {
    normalized = `+1${digits}`;
  } else if (digits.length === 11 && digits.startsWith("1")) {
    normalized = `+${digits}`;
  } else {
    throw new Error(`phone has unsupported length: ${digits.length}`);
  }
  return normalized;
}
