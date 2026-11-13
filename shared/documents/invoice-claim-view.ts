/**
 * REQ-479 (demo M30, cycle 3): the public invoice's claim box for the
 * business's own viewer. Mirrors REQ-306's `internalPreview` for quotes and
 * REQ-398's `changeOrderPreview`: the owner (or an admin / staff acting for
 * her) previewing her own open invoice sees "you are viewing as the
 * customer" and "Record a payment you received" — never the "I sent it"
 * claim — unless the in-person override `?as=customer&confirm=1` is on.
 */
import {
  hasSignOverride,
  SIGN_OVERRIDE_QUERY,
} from "../quote-flow/public-doc-state.ts";

/** True when the claim box renders as the owner's preview. A paid or void
 *  invoice has nothing to claim, so it is never a preview. */
export function invoiceClaimPreview(
  payload: { internal?: boolean; status?: string },
  search: string | undefined | null,
): boolean {
  if (payload.internal !== true) return false;
  if (payload.status === "paid" || payload.status === "void") return false;
  return !hasSignOverride(search);
}

/** The owner's own action: open the invoice on "Payment received" (REQ-018). */
export function recordPaymentHref(invoiceId: string): string {
  return `/invoices?open=${encodeURIComponent(invoiceId)}&pay=1`;
}

/** The claim POST; carries the in-person override only when the page has it. */
export function claimPaymentPath(
  invoiceId: string,
  search: string | undefined | null,
): string {
  const path = `/api/invoices/${invoiceId}/claim-payment`;
  return hasSignOverride(search) ? `${path}?${SIGN_OVERRIDE_QUERY}` : path;
}
