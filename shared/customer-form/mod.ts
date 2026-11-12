/**
 * REQ-625 — the ONE customer form's rules, shared by every entry point that
 * creates a customer (Clients page, new invoice, the assistant's customer
 * step) and by the edit form (PUT /customers/:id). Pure: no DOM, no i18n.
 */
import { formatPhoneInput } from "../quote-flow/format-helpers.ts";
import { splitAddress } from "../customer-address/mod.ts";

export interface CustomerFormValues {
  name: string;
  businessName: string;
  phone: string;
  email: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  notes: string;
}

export type CustomerFormField = keyof CustomerFormValues;

/** The QuickBooks customer shape (name, company, phone, email, street, city,
 *  state, zip) plus notes — in the order the form shows them. */
export const CUSTOMER_FORM_FIELDS: CustomerFormField[] = [
  "name",
  "businessName",
  "phone",
  "email",
  "street",
  "city",
  "state",
  "zip",
  "notes",
];

export function emptyCustomerForm(): CustomerFormValues {
  return {
    name: "",
    businessName: "",
    phone: "",
    email: "",
    street: "",
    city: "",
    state: "",
    zip: "",
    notes: "",
  };
}

/** What a stored customer can carry (the backend's Customer, any subset). */
export interface CustomerLike {
  name?: string;
  businessName?: string;
  phoneNumber?: string;
  email?: string;
  address?: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  notes?: string;
}

const s = (v: unknown): string => (typeof v === "string" ? v : "");

/** Prefill the edit form. Stored parts win; a customer saved before the
 *  parts existed has its one-line address split (unreadable text → street). */
export function customerFormFrom(
  c: CustomerLike | null | undefined,
): CustomerFormValues {
  if (!c) return emptyCustomerForm();
  const hasParts = [c.street, c.city, c.state, c.zip].some((p) => s(p).trim());
  const parts = hasParts
    ? { street: s(c.street), city: s(c.city), state: s(c.state), zip: s(c.zip) }
    : splitAddress(c.address);
  return {
    name: s(c.name),
    businessName: s(c.businessName),
    phone: s(c.phoneNumber),
    email: s(c.email),
    street: s(parts.street),
    city: s(parts.city),
    state: s(parts.state),
    zip: s(parts.zip),
    notes: s(c.notes),
  };
}

export type CustomerFormErrors = Partial<
  Record<"name" | "phone" | "email", "required" | "invalid">
>;

/** Lenient: any format (spaces, dots, dashes, parens, +country, ext) with at
 *  least 7 digits — a local number is the shortest a contractor would save. */
export function isPhoneLike(raw: string): boolean {
  return raw.replace(/\D/g, "").length >= 7;
}

/** Lenient: something@something.tld, no spaces. */
export function isEmailLike(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());
}

export function validateCustomerForm(
  v: CustomerFormValues,
): CustomerFormErrors {
  const out: CustomerFormErrors = {};
  if (!v.name.trim()) out.name = "required";
  if (v.phone.trim() && !isPhoneLike(v.phone)) out.phone = "invalid";
  if (v.email.trim() && !isEmailLike(v.email)) out.email = "invalid";
  return out;
}

/**
 * The as-you-type phone mask, made lenient: a plain US number still reads
 * "(512) 555-0101" as it is typed, but anything typed with a "+" (another
 * country), with letters (an extension) or longer than a US number is left
 * exactly as typed — the old mask cut every number to ten digits.
 */
export function formatPhoneLenient(raw: string): string {
  const v = raw ?? "";
  if (!v.trim()) return "";
  if (v.trim().startsWith("+")) return v;
  if (/[A-Za-z#]/.test(v)) return v;
  const d = v.replace(/\D/g, "");
  if (d.length > 11 || (d.length === 11 && !d.startsWith("1"))) return v;
  return formatPhoneInput(v);
}

const API_KEY: Record<CustomerFormField, string> = {
  name: "name",
  businessName: "businessName",
  phone: "phoneNumber",
  email: "email",
  street: "street",
  city: "city",
  state: "state",
  zip: "zip",
  notes: "notes",
};

export interface CustomerPayload {
  name: string;
  businessName?: string;
  phoneNumber?: string;
  email?: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  notes?: string;
}

/** POST /customers: every filled field, trimmed; empty ones left out. */
export function customerCreatePayload(v: CustomerFormValues): CustomerPayload {
  const out: Record<string, string> = {};
  for (const f of CUSTOMER_FORM_FIELDS) {
    const val = v[f].trim();
    if (val) out[API_KEY[f]] = val;
  }
  out.name = v.name.trim();
  return out as unknown as CustomerPayload;
}

/** PUT /customers/:id: every field — an emptied one clears it; the address
 *  parts always travel together so the server recomposes `address`. */
export function customerUpdatePayload(
  v: CustomerFormValues,
): Required<CustomerPayload> {
  const out: Record<string, string> = {};
  for (const f of CUSTOMER_FORM_FIELDS) out[API_KEY[f]] = v[f].trim();
  return out as unknown as Required<CustomerPayload>;
}
