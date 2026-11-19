/**
 * REQ-501 (demo-loop cycle 3, M35) — the ONE rule for the account fields Settings saves on blur,
 * asked by the Settings card before it saves and by the backend on PUT /me and
 * PUT /profile/identity. Each answer is a dictionary key the client shows inline.
 *
 * - Email: the same address shape as a customer's (REQ-278, `isValidCustomerEmail`), so
 *   "carl@@jensen" is refused. Blank is allowed — it clears the email.
 * - Business name: blank is refused once the business has a name. REQ-598 (cycle 4, p4-p10a): an
 *   emptied field asks for the name (`settings.businessNameRequired`); spaces alone keep the
 *   wizard's own copy (`welcome.nameBlank`, "spaces alone don't count").
 */
import { isValidCustomerEmail } from "./customer-contact.ts";
import { isValidWebsiteUrl } from "./format-helpers.ts";

export function accountEmailError(
  raw: string | null | undefined,
): "customer.invalidEmail" | null {
  const email = (raw ?? "").trim();
  if (!email) return null;
  return isValidCustomerEmail(email) ? null : "customer.invalidEmail";
}

export function businessNameError(
  next: string | null | undefined,
  current: string | null | undefined,
): "settings.businessNameRequired" | "welcome.nameBlank" | null {
  if (next === undefined || next === null) return null;
  if (next.trim()) return null;
  if (!(current ?? "").trim()) return null;
  return next === "" ? "settings.businessNameRequired" : "welcome.nameBlank";
}

/**
 * REQ-978 (LOOP-007 q1, q1-58) — the number fields follow the same pattern: a bad value is
 * refused with a dictionary key shown under the field, never put back silently.
 *
 * - Days to pay an invoice (REQ-174): a whole number from 0 to 365.
 * - Overhead per visit (REQ-788 + AMENDMENT): not blank, ≥ 0, and ≤ 100 in % mode.
 * - A money amount (REQ-926 chargeback fee): not blank, ≥ 0.
 */
export function netDaysError(
  raw: string | null | undefined,
): "settings.netDaysInvalid" | null {
  const s = (raw ?? "").trim();
  if (!s) return "settings.netDaysInvalid";
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 && n <= 365
    ? null
    : "settings.netDaysInvalid";
}

export function moneyError(
  raw: string | null | undefined,
): "settings.moneyInvalid" | null {
  const s = (raw ?? "").trim();
  if (!s) return "settings.moneyInvalid";
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? null : "settings.moneyInvalid";
}

export function overheadError(
  raw: string | null | undefined,
  mode: "flat" | "percent",
): "settings.overheadPctInvalid" | "settings.moneyInvalid" | null {
  if (mode !== "percent") return moneyError(raw);
  const s = (raw ?? "").trim();
  const n = Number(s);
  return s && Number.isFinite(n) && n >= 0 && n <= 100
    ? null
    : "settings.overheadPctInvalid";
}

/**
 * REQ-1043 (LOOP-007 q2, q2-27) — the business website: a value that would not link
 * ("reyes tile dot com") is refused with a key shown under the field and a 400 on
 * PUT /profile/identity; blank is allowed (it clears the website).
 */
export function websiteUrlError(
  raw: string | null | undefined,
): "settings.websiteInvalid" | null {
  return isValidWebsiteUrl(raw) ? null : "settings.websiteInvalid";
}
