/**
 * REQ-501 (demo-loop cycle 3, M35) — the ONE rule for the account fields Settings saves on blur,
 * asked by the Settings card before it saves and by the backend on PUT /me and
 * PUT /profile/identity. Each answer is a dictionary key the client shows inline.
 *
 * - Email: the same address shape as a customer's (REQ-278, `isValidCustomerEmail`), so
 *   "carl@@jensen" is refused. Blank is allowed — it clears the email.
 * - Business name: blank (spaces alone included) is refused once the business has a name, with
 *   the wizard's own copy (`welcome.nameBlank`).
 */
import { isValidCustomerEmail } from "./customer-contact.ts";

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
): "welcome.nameBlank" | null {
  if (next === undefined || next === null) return null;
  if (next.trim()) return null;
  return (current ?? "").trim() ? "welcome.nameBlank" : null;
}
