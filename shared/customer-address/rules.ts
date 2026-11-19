/**
 * REQ-992 (LOOP-007 cycle 1, q1-74) — the format rules for a customer's
 * address parts. The customer form took State "Texasssss" and ZIP "ABCDE" and
 * the composed "1200 Barton Springs Rd, Austin, Texasssss ABCDE" went onto
 * every invoice, quote and PDF. Run by the customer form (shared/customer-form)
 * AND by the backend's customer DTO gate, so no writer can store them.
 *
 * ZIP: the REQ-352 rule onboarding uses (5 digits, or ZIP+4).
 * State: a USPS 2-letter code or a full state name, any case.
 * Blank is always valid — whether a part is required is not this rule's call.
 */
import { isValidUsZip } from "../quote-flow/business-fields.ts";
import { US_STATES } from "./us-states.ts";

const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(US_STATES).map(([code, name]) => [name.toLowerCase(), code]),
);

/** The USPS code for a code or a full name ("texas" → "TX"), or null. */
export function stateCode(raw: unknown): string | null {
  const v = clean(raw).replace(/\s+/g, " ");
  if (!v) return null;
  const up = v.toUpperCase();
  if (US_STATES[up]) return up;
  return NAME_TO_CODE[v.toLowerCase()] ?? null;
}

export function isValidUsState(raw: unknown): boolean {
  return stateCode(raw) !== null;
}

export interface AddressPartErrors {
  state?: "invalid";
  zip?: "invalid";
}

/** Which of state / zip is malformed; an empty object when both are fine. */
export function addressPartErrors(
  p: { state?: unknown; zip?: unknown },
): AddressPartErrors {
  const out: AddressPartErrors = {};
  const state = clean(p.state);
  const zip = clean(p.zip);
  if (state && !isValidUsState(state)) out.state = "invalid";
  if (zip && !isValidUsZip(zip)) out.zip = "invalid";
  return out;
}

export type AddressPartErrorKey =
  | "customer.invalidState"
  | "customer.invalidZip";

/** The backend's dictionary key for the first bad part, or null. */
export function addressPartError(
  p: { state?: unknown; zip?: unknown },
): AddressPartErrorKey | null {
  const e = addressPartErrors(p);
  if (e.state) return "customer.invalidState";
  if (e.zip) return "customer.invalidZip";
  return null;
}
