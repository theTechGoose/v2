/**
 * REQ-557 (demo-loop cycle 4, issue M25): the business's own viewer of a
 * CLAIMED invoice on /i/:id. The customer's "You told {who} you paid" note is
 * the customer's voice; the owner (or an admin / staff acting for her) sees
 * "{customer} says they paid by Zelle · ref …" with Confirm received /
 * Didn't get it — the same actions /invoices and /payments offer — and a link
 * to the invoice on /invoices. The in-person override (`?as=customer&confirm=1`)
 * keeps the customer's note for the customer in the room.
 *
 * Pure: the caller passes its dictionary lookup.
 */
import { hasSignOverride } from "../quote-flow/public-doc-state.ts";

export type Translate = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

/** True when the claimed invoice's note is the owner's, not the customer's. */
export function ownerClaimNoteShown(
  payload: { internal?: boolean; status?: string; paymentIntent?: unknown },
  search: string | undefined | null,
): boolean {
  if (payload.internal !== true) return false;
  if (payload.status !== "claimed" || !payload.paymentIntent) return false;
  return !hasSignOverride(search);
}

export interface OwnerClaimNoteInput {
  /** Who claimed (the claim's own name, else the invoice's customer). */
  customer?: string;
  /** The claimed method in the page's words ("Zelle", "Efectivo"). */
  methodName: string;
  reference?: string;
}

export interface OwnerClaimNote {
  heading: string;
  body: string;
  hint: string;
  confirm: string;
  reject: string;
  open: string;
  failed: string;
}

export function ownerClaimNote(
  t: Translate,
  { customer, methodName, reference }: OwnerClaimNoteInput,
): OwnerClaimNote {
  const who = customer?.trim() ||
    t("publicInvoice.ownerClaim.customerFallback");
  const ref = reference?.trim();
  return {
    heading: t("publicInvoice.ownerClaim.heading"),
    body: ref
      ? t("publicInvoice.ownerClaim.noteRef", {
        customer: who,
        method: methodName,
        ref,
      })
      : t("publicInvoice.ownerClaim.note", {
        customer: who,
        method: methodName,
      }),
    hint: t("publicInvoice.ownerClaim.hint"),
    confirm: t("publicInvoice.ownerClaim.confirm"),
    reject: t("publicInvoice.ownerClaim.reject"),
    open: t("publicInvoice.ownerClaim.open"),
    failed: t("publicInvoice.ownerClaim.failed"),
  };
}

/** The owner's "Confirm received" — records the Payment (REQ-018). */
export function confirmPaymentPath(invoiceId: string): string {
  return `/api/invoices/${encodeURIComponent(invoiceId)}/confirm-payment`;
}

/** The owner's "Didn't get it" — reopens the invoice (REQ-488). */
export function rejectClaimPath(invoiceId: string): string {
  return `/api/invoices/${encodeURIComponent(invoiceId)}/reject-claim`;
}

/** The invoice on /invoices, where the same claim can be handled. */
export function reviewClaimHref(invoiceId: string): string {
  return `/invoices?open=${encodeURIComponent(invoiceId)}`;
}
