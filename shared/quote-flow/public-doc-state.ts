/**
 * Public-document view state, derived from the public payloads
 * (GET /quotes/:id/public and GET /contracts/:id/public):
 *   P-11 a reloaded accepted /q/:id renders a persisted accepted state —
 *        the backend writes status "approved" on accept (legacy rows may
 *        carry "accepted"), and both must map to the accepted view.
 *   P-13 the contract names the customer (payload.customer.name).
 *   P-40 the signed contract view exposes the stored signature image.
 *   P-63 signed /c: post-signed footer variant + PDF download url
 *        (invoice precedent: /api/invoices/:id/pdf).
 */

export interface PublicQuotePayloadLike {
  status?: string;
  acceptedName?: string;
  acceptedAt?: string;
}

export interface QuoteView {
  mode: "open" | "accepted" | "declined";
  acceptedBy?: string;
  acceptedAt?: string;
}

/** Derive the /q/:id view state from the public quote payload. */
export function deriveQuoteView(payload: PublicQuotePayloadLike): QuoteView {
  // "approved" is what POST /quotes/:id/accept actually writes; legacy
  // rows may still say "accepted". Both are the persisted accepted state.
  if (payload.status === "approved" || payload.status === "accepted") {
    const view: QuoteView = { mode: "accepted" };
    if (payload.acceptedName) view.acceptedBy = payload.acceptedName;
    if (payload.acceptedAt) view.acceptedAt = payload.acceptedAt;
    return view;
  }
  if (payload.status === "lost") return { mode: "declined" };
  return { mode: "open" };
}

export interface PublicContractPayloadLike {
  id: string;
  status?: string;
  customer?: { name?: string };
  customerSignature?: string;
}

export interface ContractView {
  customerName: string;
  signed: boolean;
  signatureImage?: string;
  footerVariant: "beforeSigning" | "signed";
  pdfUrl?: string;
}

/** Derive the /c/:id view state from the public contract payload. */
export function deriveContractView(
  payload: PublicContractPayloadLike,
): ContractView {
  const signed = payload.status === "signed";
  const view: ContractView = {
    customerName: payload.customer?.name ?? "",
    signed,
    footerVariant: signed ? "signed" : "beforeSigning",
  };
  if (signed) {
    if (payload.customerSignature) {
      view.signatureImage = payload.customerSignature;
    }
    view.pdfUrl = `/api/contracts/${payload.id}/pdf`;
  }
  return view;
}
