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
  signedAt?: string;
  customerSignedName?: string;
  /** Linked quote's acceptance evidence (UX-37): "approved" is what
   *  POST /quotes/:id/accept writes; legacy rows may say "accepted". */
  quoteStatus?: string;
  quoteAcceptedAt?: string;
  quoteAcceptedName?: string;
}

/** How the one agreement got accepted (UX-37). */
export interface AcceptedEvidence {
  at?: string;
  by?: string;
  via: "contractSign" | "quoteAccept";
}

export interface ContractView {
  customerName: string;
  signed: boolean;
  signatureImage?: string;
  footerVariant: "beforeSigning" | "signed";
  pdfUrl?: string;
  /** True ONLY when a fresh signature ceremony is appropriate: the contract
   *  is not signed AND the linked quote is not accepted (UX-37 — one deal,
   *  one ceremony). The /c page must consult this before rendering the pad. */
  pendingSignature: boolean;
  /** Present whenever pendingSignature is false. */
  acceptedEvidence?: AcceptedEvidence;
}

function quoteAccepted(payload: PublicContractPayloadLike): boolean {
  return payload.quoteStatus === "approved" ||
    payload.quoteStatus === "accepted";
}

/** Derive the /c/:id view state from the public contract payload. */
export function deriveContractView(
  payload: PublicContractPayloadLike,
): ContractView {
  const signed = payload.status === "signed";
  const accepted = quoteAccepted(payload);
  const view: ContractView = {
    customerName: payload.customer?.name ?? "",
    signed,
    footerVariant: signed ? "signed" : "beforeSigning",
    pendingSignature: !signed && !accepted,
  };
  if (signed) {
    if (payload.customerSignature) {
      view.signatureImage = payload.customerSignature;
    }
    view.pdfUrl = `/api/contracts/${payload.id}/pdf`;
    const evidence: AcceptedEvidence = { via: "contractSign" };
    if (payload.signedAt) evidence.at = payload.signedAt;
    if (payload.customerSignedName) evidence.by = payload.customerSignedName;
    view.acceptedEvidence = evidence;
  } else if (accepted) {
    const evidence: AcceptedEvidence = { via: "quoteAccept" };
    if (payload.quoteAcceptedAt) evidence.at = payload.quoteAcceptedAt;
    if (payload.quoteAcceptedName) evidence.by = payload.quoteAcceptedName;
    view.acceptedEvidence = evidence;
  }
  return view;
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
