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

/**
 * REQ-532 (demo-loop cycle 3, p8-pair5-b): the create form follows the
 * Business / Person pick from the lock-quote CTA.
 *  - person   → the required field is the person's "Name"; the business name
 *               is not shown, only a "+ Add a business name" link that
 *               reveals it (optional);
 *  - business → the required field IS the business name ("Business name");
 *               there is no second business-name input.
 */
export type CustomerKind = "business" | "person";

export interface CustomerCreateShape {
  /** i18n key for the one required name field's placeholder/label. */
  nameKey: string;
  /** Render the optional business-name input (data-cy wizard-business-name). */
  showBusinessField: boolean;
  /** Render the "+ Add a business name" link (data-cy wizard-add-business-name). */
  offerAddBusiness: boolean;
}

export function customerCreateShape(
  kind: CustomerKind,
  addBusinessOpen = false,
): CustomerCreateShape {
  if (kind === "business") {
    return {
      nameKey: "asstChat.customerStep.businessNameRequired",
      showBusinessField: false,
      offerAddBusiness: false,
    };
  }
  return {
    nameKey: "asstChat.customerStep.name",
    showBusinessField: addBusinessOpen,
    offerAddBusiness: !addBusinessOpen,
  };
}

/** The `businessName` to save: a business's is the required name itself; a
 *  person's is the optional field, when filled. */
export function customerCreateBusinessName(
  kind: CustomerKind,
  name: string,
  businessInput: string,
): string | undefined {
  const v = (kind === "business" ? name : businessInput).trim();
  return v ? v : undefined;
}
