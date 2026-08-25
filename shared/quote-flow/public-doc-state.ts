/**
 * Public-document view state, derived from the public payload
 * (GET /quotes/:id/public):
 *   P-11 a reloaded accepted /q/:id renders a persisted accepted state.
 *   P-13 the agreement names the customer (payload.customer.name).
 *   P-40 the accepted view exposes the stored signature image.
 *   P-63 accepted /q: post-accept footer variant + PDF download url
 *        (invoice precedent: /api/invoices/:id/pdf).
 *
 * The quote IS the agreement (UX-36/UX-37): one document, one signature
 * ceremony, so this is the single derive for the whole customer-facing doc.
 */

import { isAccepted } from "./quote-status.ts";

export interface PublicQuotePayloadLike {
  id: string;
  status?: string;
  acceptedName?: string;
  acceptedAt?: string;
  acceptedSignature?: string;
  customer?: { name?: string };
}

export interface QuoteView {
  mode: "open" | "accepted" | "declined";
  customerName: string;
  acceptedBy?: string;
  acceptedAt?: string;
  /** The stored signature image (P-40), present once accepted. */
  signatureImage?: string;
  footerVariant: "beforeSigning" | "signed";
  /** Present once accepted (P-63). */
  pdfUrl?: string;
  /** True ONLY when a fresh signature ceremony is appropriate: the quote is
   *  neither accepted nor declined — one deal, one ceremony (UX-37). */
  pendingSignature: boolean;
}

/** Derive the /q/:id view state from the public quote payload. */
export function deriveQuoteView(payload: PublicQuotePayloadLike): QuoteView {
  const customerName = payload.customer?.name ?? "";
  if (isAccepted(payload)) {
    const view: QuoteView = {
      mode: "accepted",
      customerName,
      footerVariant: "signed",
      pdfUrl: `/api/quotes/${payload.id}/pdf`,
      pendingSignature: false,
    };
    if (payload.acceptedName) view.acceptedBy = payload.acceptedName;
    if (payload.acceptedAt) view.acceptedAt = payload.acceptedAt;
    if (payload.acceptedSignature) {
      view.signatureImage = payload.acceptedSignature;
    }
    return view;
  }
  if (payload.status === "lost") {
    return {
      mode: "declined",
      customerName,
      footerVariant: "beforeSigning",
      pendingSignature: false,
    };
  }
  return {
    mode: "open",
    customerName,
    footerVariant: "beforeSigning",
    pendingSignature: true,
  };
}

/* ---------- per-language line items ---------- */

export interface LineItemLike {
  description: string;
  price?: number;
  quantity?: number;
  unit?: string;
}

/**
 * Project the itemized job into the language the document is rendered in.
 *
 * `lineItemsByLang[lang]` is positionally aligned with `lineItems`; prices,
 * quantities and units are language-neutral, so only the description swaps.
 * A missing translation (or a stale array whose length no longer matches
 * after the contractor edited the lines) falls back to the stored
 * description rather than dropping or mis-pairing a line — the customer must
 * always see every line she is being charged for.
 *
 * Without this the customer's itemized table stayed in the language the
 * contractor typed in even when the quote was sent in the other one — the
 * product's headline promise ("everything goes out in perfect English")
 * failing on the one page the customer actually reads.
 */
export function projectLineItems<T extends LineItemLike>(
  items: readonly T[] | undefined,
  byLang: Record<string, string[]> | undefined,
  lang: string,
): T[] {
  const list = items ?? [];
  const translated = byLang?.[lang];
  if (!translated || translated.length !== list.length) return [...list];
  return list.map((li, i) => {
    const t = translated[i]?.trim();
    return t ? { ...li, description: t } : li;
  });
}
