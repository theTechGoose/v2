/**
 * REQ-352 (demo-loop cycle 1, demo M38) — the format rules for the business's
 * own details the onboarding wizard collects: the ZIP on the address step and
 * the Zelle / Venmo / Cash App handles on the payment step. The demo saved ZIP
 * "7870" and a Zelle handle "asdf".
 *
 * Blank is never a format error here: whether a field is REQUIRED is the
 * step's call. Every non-null result is a dictionary key.
 */
import {
  isValidCustomerEmail,
  isValidCustomerPhone,
} from "./customer-contact.ts";

const US_ZIP = /^\d{5}(-\d{4})?$/;

/** 5 digits, or ZIP+4 ("78701-1234"). */
export function isValidUsZip(raw: string): boolean {
  return US_ZIP.test((raw ?? "").trim());
}

export type ZipErrorKey = "welcome.address.zipInvalid";

/** The message key for a malformed ZIP, or null (blank or well-formed). */
export function zipError(raw: string): ZipErrorKey | null {
  const zip = (raw ?? "").trim();
  return zip && !isValidUsZip(zip) ? "welcome.address.zipInvalid" : null;
}

export type HandleMethod = "zelle" | "venmo" | "cashapp";
export type HandleErrorKey = `welcome.payment.invalid.${HandleMethod}`;

/** Venmo usernames: letters, digits, "-" and "_" after the "@". */
const VENMO_USER = /^@[A-Za-z0-9_-]{2,30}$/;
/** Cash App cashtags: "$" then a letter-led name of up to 20 characters. */
const CASHTAG = /^\$[A-Za-z][A-Za-z0-9_]{0,19}$/;

/**
 * The message key for a payment handle a customer could not pay to, or null.
 * Zelle is a phone or an email by definition; Venmo also takes an @username,
 * Cash App a $cashtag.
 */
export function paymentHandleError(
  method: HandleMethod,
  raw: string,
): HandleErrorKey | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (isValidCustomerPhone(v) || isValidCustomerEmail(v)) return null;
  if (method === "venmo" && VENMO_USER.test(v)) return null;
  if (method === "cashapp" && CASHTAG.test(v)) return null;
  return `welcome.payment.invalid.${method}`;
}
