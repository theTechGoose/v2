/**
 * REQ-600 (demo-loop cycle 4, issue M5) — the /customers card edits its own
 * phone, email and address, and opens from a link.
 *
 * A customer made from Field → Add task carries only a name and an address,
 * so a batch invoice to them failed with `noRecipient` and nothing on the
 * customer side could add a contact. The card now saves one field at a time
 * through PUT /customers/:id, checked with the New customer form's own rule
 * (`customerFormErrors`, REQ-278/352), and `/customers?open=<id>` opens that
 * customer's card — the batch send's "Add an email or phone" fix points there.
 * Pure, so it is tested in jest/unit/c4-customer-card-edit.test.ts.
 */
import {
  type CustomerContactErrorKey,
  customerFormErrors,
} from "../../shared/quote-flow/customer-contact.ts";

export type CardField = "phone" | "email" | "address";

/** the customer id in `?open=<id>`, or null */
export function openIdFromSearch(
  search: string | null | undefined,
): string | null {
  if (!search) return null;
  const id = new URLSearchParams(search).get("open");
  return id ? id : null;
}

/** where a "fix this customer" link goes: their own card, else the list */
export function customerFixHref(customerId?: string | null): string {
  return customerId
    ? `/customers?open=${encodeURIComponent(customerId)}`
    : "/customers";
}

/**
 * The PUT body for one edited card field, or the dictionary key that refuses
 * it. Blank clears the field (whether a contact is REQUIRED is not the card's
 * call); a typed phone or email must pass the customer form's rule.
 */
export function cardFieldPatch(
  field: CardField,
  raw: string,
): { patch: Record<string, string> } | { error: CustomerContactErrorKey } {
  const value = (raw ?? "").trim();
  if (field === "address") return { patch: { address: value } };
  if (field === "phone") {
    const err = customerFormErrors({ name: "-", phoneNumber: value }).phone;
    return err ? { error: err } : { patch: { phoneNumber: value } };
  }
  const err = customerFormErrors({ name: "-", email: value }).email;
  return err ? { error: err } : { patch: { email: value } };
}

/** the backend's refusal (REQ-278: its message IS the key), when it names a field */
export function apiFieldErrorKey(
  message: unknown,
): CustomerContactErrorKey | null {
  return message === "customer.invalidPhone" ||
      message === "customer.invalidEmail"
    ? message
    : null;
}
