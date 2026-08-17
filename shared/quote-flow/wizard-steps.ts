/**
 * "Who is this for?" step schema (raw-plan p7): Name / Business Name /
 * Phone / Email. Business name is optional — homeowners don't have one;
 * email stays optional as labeled in the UI.
 */

export interface WizardField {
  key: string;
  required: boolean;
}

export const WHO_IS_THIS_FOR_FIELDS: readonly WizardField[] = [
  { key: "name", required: true },
  { key: "businessName", required: false },
  { key: "phone", required: true },
  { key: "email", required: false },
];
