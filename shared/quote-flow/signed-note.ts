/**
 * REQ-403 (demo-loop cycle 2, issue m11): the line under "Signed and
 * binding" on the public agreement promises only a confirmation that can
 * arrive. The server says which channel can carry it (`confirmChannel` on
 * `GET /quotes/:id/public`): an email, a text to a number whose latest text
 * did not fail, or none — then the page says the contractor has the signed
 * copy and points at the PDF download.
 *
 * REQ-560 (demo-loop cycle 4, issue p4-p2b): those three notes speak to the
 * customer on their own device. When the viewer is the business itself
 * (`internal`), the note speaks about the customer instead: signed in person
 * (the REQ-306/405 `?as=customer&confirm=1` override is on) — "Signed in
 * person — {customer} gets a copy at {email}" / "by text" — or, without the
 * override, where the customer's copy went.
 */
import { hasSignOverride } from "./public-doc-state.ts";

export type ConfirmChannel = "email" | "text" | "none";

export type SignedNoteKey =
  | "quoteDoc.signedNote"
  | "quoteDoc.signedNoteSms"
  | "quoteDoc.signedNoteKept"
  | "quoteDoc.signedNoteInPerson"
  | "quoteDoc.signedNoteInPersonSms"
  | "quoteDoc.signedNoteInPersonKept"
  | "quoteDoc.signedNoteOwner"
  | "quoteDoc.signedNoteOwnerSms"
  | "quoteDoc.signedNoteOwnerKept";

export function signedNoteKey(
  q: {
    confirmChannel?: ConfirmChannel | string;
    customer?: { email?: string | null } | null;
    /** REQ-306: the viewer is the business itself, not the customer. */
    internal?: boolean;
  },
  /** REQ-560: the page's query string — carries the in-person override. */
  search?: string | null,
): SignedNoteKey {
  const ch = q.confirmChannel ??
    (q.customer?.email?.trim() ? "email" : "none");
  const base = q.internal !== true
    ? "quoteDoc.signedNote"
    : hasSignOverride(search)
    ? "quoteDoc.signedNoteInPerson"
    : "quoteDoc.signedNoteOwner";
  if (ch === "email") return base;
  if (ch === "text") return `${base}Sms`;
  return `${base}Kept`;
}

/** REQ-560: the `{customer}` / `{email}` the business-side notes name. */
export function signedNoteParams(
  q: {
    customer?: { name?: string | null; email?: string | null } | null;
    acceptedName?: string | null;
  },
  customerFallback: string,
): { customer: string; email: string } {
  return {
    customer: q.customer?.name?.trim() || q.acceptedName?.trim() ||
      customerFallback,
    email: q.customer?.email?.trim() ?? "",
  };
}
