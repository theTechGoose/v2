/**
 * REQ-488 (demo-loop cycle 3, issue m56) — what the customer's public invoice
 * (/i/:id) says after the contractor answered their "I paid" claim with
 * "Didn't get it": the invoice is back to unpaid, and instead of a silent
 * "How do you want to pay?" the page explains the payment hasn't arrived and
 * where to check it went (the contractor's handle for that method, when set).
 *
 * Shown only while the invoice is open again (not paid, not re-claimed — a
 * new claim clears `claimRejectedAt` on the server too).
 *
 * Pure: the caller passes its dictionary lookup (`tFor` bound to the page
 * language on /i; the raw lang/*.json in the unit test).
 */
export type Translate = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

export interface ClaimRejectedInput {
  status?: string;
  claimRejectedAt?: string;
  /** The claimed method in the page's words ("Zelle", "Cash"). */
  methodName: string;
  /** Where that method's money goes (the contractor's Zelle email…). */
  handle?: string;
  /** The contractor's first name, or the page's fallback. */
  who: string;
}

export function claimRejectedNote(
  t: Translate,
  { status, claimRejectedAt, methodName, handle, who }: ClaimRejectedInput,
): { heading: string; body: string } | null {
  if (!claimRejectedAt) return null;
  if (status === "paid" || status === "claimed" || status === "void") {
    return null;
  }
  const to = handle?.trim();
  return {
    heading: t("publicInvoice.claimRejected.heading", { who }),
    body: to
      ? t("publicInvoice.claimRejected.bodyTo", {
        method: methodName,
        handle: to,
      })
      : t("publicInvoice.claimRejected.body", { method: methodName }),
  };
}
