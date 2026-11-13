import { customerPhoneE164 } from "#quote-flow/customer-contact.ts";
import { isFictionalUsNumber } from "#quote-flow/sms-number.ts";

/**
 * Normalize a phone string into E.164 form (e.g., "+15125551234").
 *
 * Accepts: "(512) 555-1234", "512-555-1234", "5125551234", "+1 512 555 1234".
 * Defaults the country code to "+1" (US/CA) when 10 digits are supplied.
 * Throws when the result isn't a plausible 11-15 digit international number.
 */
// REQ-569 (demo-loop cycle 4, m46): the fictional-number rule lives in
// shared/ so the send dialog applies the same predicate as this guard.
export { isFictionalUsNumber } from "#quote-flow/sms-number.ts";

/** REQ-523: why a number cannot be texted, or the E.164 form to dial. */
export type SmsTarget =
  | { ok: true; e164: string }
  | { ok: false; failureCode: "missing" | "invalid" }
  | { ok: false; failureCode: "fictional"; e164: string };

/**
 * REQ-523 (demo-loop cycle 3, issue m16): can a text be addressed to this
 * number at all? Missing, not dialable (the customer-save rule,
 * `customerPhoneE164`), or fictional → refused with a code. SmsService.send
 * asks this before anything else, so no sender — dev mode included — ever
 * reports a text to a number that cannot get one.
 */
export function smsTarget(raw: string | null | undefined): SmsTarget {
  if (!raw?.trim()) return { ok: false, failureCode: "missing" };
  const e164 = customerPhoneE164(raw);
  if (!e164) return { ok: false, failureCode: "invalid" };
  if (isFictionalUsNumber(e164)) {
    return { ok: false, failureCode: "fictional", e164 };
  }
  return { ok: true, e164 };
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
