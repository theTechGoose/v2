/**
 * Customer-step entry rules (2026-08-19): the assistant must let the user
 * PICK AN EXISTING CUSTOMER.
 *
 * The step has two views — the pick LIST ("choose an existing customer" /
 * "+ new customer") and the create FORM. The old `preferCreate` behavior
 * opened the form even when the account had saved customers, leaving the
 * pick list reachable only through the form's footer "Atrás" — invisible
 * as a capability, and banned outright by the single-back rule.
 *
 * Rules:
 *  - anyone to pick (saved customers, or the chat-bound customer) → LIST;
 *  - nobody to pick → straight to the create FORM (no empty dropdown);
 *  - while the list is loading (unknown count) → LIST shell;
 *  - the create form offers a forward "choose an existing customer" button
 *    whenever there is anyone to pick — never a back button.
 */

export type CustomerStepView = "list" | "form";

export function customerStepEntryView(
  customerCount: number | null,
  hasBoundCustomer: boolean,
): CustomerStepView {
  if (customerCount === 0 && !hasBoundCustomer) return "form";
  return "list";
}

export function formOffersPickExisting(
  customerCount: number | null,
  hasBoundCustomer: boolean,
): boolean {
  return (customerCount ?? 0) > 0 || hasBoundCustomer;
}
