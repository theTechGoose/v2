/**
 * REQ-569 (demo-loop cycle 4, issue m46): the ONE rule for a phone number
 * that can't receive a text — shared by the backend's SMS guard (REQ-523,
 * REQ-030) and the send dialog's "Recommended" tag, so the dialog never
 * recommends a text the server is certain to refuse.
 */
import { customerPhoneE164 } from "./customer-contact.ts";

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

/**
 * REQ-569: a phone on file that is certain not to take a text — a dialable
 * number in the fictional block. Blank or malformed numbers are NOT flagged
 * here: "missing" and "invalid format" have their own dialog copy.
 */
export function phoneCantReceiveTexts(raw: string | null | undefined): boolean {
  if (!raw?.trim()) return false;
  const e164 = customerPhoneE164(raw);
  return !!e164 && isFictionalUsNumber(e164);
}
