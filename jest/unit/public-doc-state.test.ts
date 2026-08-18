/**
 * Public-document view state, derived from the REAL public payloads:
 *   P-11 "The public quote has no persisted accepted state." — a reloaded
 *        accepted /q/:id must render a persisted accepted/confirmation state
 *        (who accepted, when), never the pristine accept form again.
 *   P-13 "The contract never names the customer: 'Para: —'." — the derived
 *        contract view requires payload.customer.name (the server must add
 *        the customer block; wizard-created contracts drop it today).
 *   P-40 "The drawn signature is captured, stored… and never shown." — the
 *        signed view must expose the stored signature image.
 *   P-63 signed /c: PDF download + post-signed footer variant (the footer
 *        must stop asking "Questions before signing?" once signed).
 *
 * Target: shared/quote-flow/public-doc-state.ts   (NEW module — this suite
 * is red today with "Cannot find module"; that is the intended TDD red.)
 *
 * Expected exports:
 *   deriveQuoteView(payload): {
 *     mode: "open" | "accepted" | "declined";
 *     acceptedBy?: string;   // from payload.acceptedName (server must add it)
 *     acceptedAt?: string;   // ISO, passthrough (server must add it)
 *   }
 *     - status "approved" (canonical, what POST /quotes/:id/accept writes)
 *       AND legacy "accepted" → mode "accepted". The FE bug: the /q route
 *       only checks status === "accepted", which never matches "approved",
 *       so the pristine form re-renders after reload.
 *     - status "lost" → "declined"; draft/sent/viewed → "open".
 *   deriveContractView(payload): {
 *     customerName: string;          // from payload.customer.name (P-13)
 *     signed: boolean;               // status === "signed"
 *     signatureImage?: string;       // from payload.customerSignature (P-40)
 *     footerVariant: "beforeSigning" | "signed";  // (P-63)
 *     pdfUrl?: string;               // `/api/contracts/${id}/pdf` when signed (P-63)
 *   }
 *
 * Wiring sites (for the green agent):
 *   - front-end/routes/q/[id].tsx (QuoteCard: `accepted = quote.status ===
 *     "accepted"` never matches the backend's "approved")
 *   - front-end/components/contract-doc.tsx (PartyCard "To/Para" card, the
 *     signed customer-signature card, the qBefore footer)
 *   - backend/src/paperwork/entrypoints/public-controller/mod.ts
 *     (redactQuote drops acceptedName/acceptedAt; redactContract drops
 *     customerSignature; wizard contracts miss the customer block; no
 *     GET /contracts/:id/pdf — the invoice already has GET /invoices/:id/pdf)
 */
import {
  deriveContractView,
  deriveQuoteView,
} from "../../shared/quote-flow/public-doc-state";

// ---------------------------------------------------------------------------
// Fixtures — trimmed REAL payloads probed from the running dev stack
// (GET /quotes/:id/public and GET /contracts/:id/public on 2026-08-18).
// Fields marked "server must add" do NOT exist in today's payloads; the
// integration suite (public-doc-state.int.test.ts) pins the server delta.
// ---------------------------------------------------------------------------

/** GET /quotes/:id/public after POST /quotes/:id/accept — real shape, plus
 *  the accepted-by/at fields the server must add (P-11). */
const acceptedQuotePayload = {
  id: "5546f5ed-7d11-4466-9533-afd4c1cf0438",
  summary: "Removing junk from a backyard",
  description: "Removing junk",
  jobName: "Backyard Junk Removal",
  customerId: "e57b29a2-278d-45a2-9aa6-7b3d88c90439",
  lineItems: [
    { description: "Junk removal", quantity: 1, unit: "job", price: 55000 },
  ],
  estimatedTotal: 55000,
  status: "approved", // ← what the backend actually writes on accept
  createdAt: "2026-08-18T11:12:07.872Z",
  contractor: {
    name: "Probe Contractor",
    businessName: "PROBE LLC",
    phoneNumber: "+15125552500",
    email: "probe.tdd@blackhole.postmarkapp.com",
    commsLanguage: "en",
    hasLogo: false,
  },
  customer: { name: "Maria Probe" },
  // server must add (stored on the row by the accept handler, dropped by
  // redactQuote today):
  acceptedName: "Maria Probe",
  acceptedAt: "2026-08-18T11:12:14.000Z",
};

/** GET /contracts/:id/public after POST /contracts/:id/sign — real shape,
 *  plus the customerSignature the server must stop redacting (P-40). The
 *  customer block below is real for contracts created with a customerId;
 *  wizard-created contracts drop it today (P-13) and the server must add it
 *  back via the linked quote. */
const signedContractPayload = {
  id: "6f2ada30-a041-4713-bf1e-13c838268055",
  quoteId: "5546f5ed-7d11-4466-9533-afd4c1cf0438",
  customerId: "e57b29a2-278d-45a2-9aa6-7b3d88c90439",
  status: "signed",
  totalAmount: 55000,
  signedAt: "2026-08-18T11:13:27.889Z",
  createdAt: "2026-08-18T11:12:20.684Z",
  terms: [],
  customerSignedName: "Maria Probe",
  contractor: {
    name: "Probe Contractor",
    businessName: "PROBE LLC",
    phoneNumber: "+15125552500",
    email: "probe.tdd@blackhole.postmarkapp.com",
    commsLanguage: "en",
    hasLogo: false,
  },
  customer: {
    name: "Maria Probe",
    phoneNumber: "+15125552501",
    email: "maria.probe@blackhole.postmarkapp.com",
  },
  jobDetails: {
    summary: "Removing junk from a backyard",
    jobName: "Backyard Junk Removal",
    description: "Removing junk",
    lineItems: [
      { description: "Junk removal", quantity: 1, unit: "job", price: 55000 },
    ],
  },
  // server must add (stored on the row by the sign handler, explicitly
  // omitted by redactContract today):
  customerSignature:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR4nGNgYGD4z4AGmNAFRlgIXQAAiMkBB9dzbnMAAAAASUVORK5CYII=",
};

/** Same contract before signing (real unsigned shape: no status field on
 *  today's payload for a fresh draft; the pre-sign page treats it as open). */
const unsignedContractPayload = {
  ...signedContractPayload,
  status: undefined as string | undefined,
  signedAt: undefined as string | undefined,
  customerSignedName: undefined as string | undefined,
  customerSignature: undefined as string | undefined,
};

// ---------------------------------------------------------------------------
// P-11 — deriveQuoteView
// ---------------------------------------------------------------------------

describe("P-11 deriveQuoteView — persisted accepted state on /q/:id", () => {
  it("P-11 an accepted payload (status 'approved') yields mode 'accepted', never the open form", () => {
    const view = deriveQuoteView(acceptedQuotePayload);
    expect(view.mode).toBe("accepted");
    expect(view.mode).not.toBe("open");
  });

  it("P-11 the accepted view carries who accepted and when", () => {
    const view = deriveQuoteView(acceptedQuotePayload);
    expect(view.acceptedBy).toBe("Maria Probe");
    expect(view.acceptedAt).toBe("2026-08-18T11:12:14.000Z");
  });

  it("P-11 legacy status 'accepted' also yields mode 'accepted'", () => {
    const view = deriveQuoteView({
      ...acceptedQuotePayload,
      status: "accepted",
    });
    expect(view.mode).toBe("accepted");
  });

  it("P-11 status 'approved' is accepted even when the name/date fields are still missing (today's payload)", () => {
    // Defensive: even before the server adds acceptedName/acceptedAt, the
    // page must NOT fall back to the re-acceptance form.
    const { acceptedName: _n, acceptedAt: _a, ...bare } = acceptedQuotePayload;
    const view = deriveQuoteView(bare);
    expect(view.mode).toBe("accepted");
  });

  it("P-11 a declined payload (status 'lost') yields mode 'declined'", () => {
    const view = deriveQuoteView({ ...acceptedQuotePayload, status: "lost" });
    expect(view.mode).toBe("declined");
  });

  it("P-11 an open payload (draft/sent/viewed) yields mode 'open'", () => {
    for (const status of ["draft", "sent", "viewed"]) {
      expect(deriveQuoteView({ ...acceptedQuotePayload, status }).mode).toBe(
        "open",
      );
    }
  });
});

// ---------------------------------------------------------------------------
// P-13 — deriveContractView names the customer
// ---------------------------------------------------------------------------

describe("P-13 deriveContractView — the contract names the customer", () => {
  it("P-13 exposes customerName from payload.customer.name (unsigned)", () => {
    const view = deriveContractView(unsignedContractPayload);
    expect(view.customerName).toBe("Maria Probe");
  });

  it("P-13 exposes customerName after signing too", () => {
    const view = deriveContractView(signedContractPayload);
    expect(view.customerName).toBe("Maria Probe");
  });
});

// ---------------------------------------------------------------------------
// P-40 — signed view exposes the drawn signature image
// ---------------------------------------------------------------------------

describe("P-40 deriveContractView — signed view carries the signature image", () => {
  it("P-40 signatureImage is the stored PNG data URL on a signed contract", () => {
    const view = deriveContractView(signedContractPayload);
    expect(view.signed).toBe(true);
    expect(view.signatureImage).toBe(signedContractPayload.customerSignature);
    expect(view.signatureImage).toMatch(/^data:image\/png/);
  });

  it("P-40 an unsigned contract has no signatureImage", () => {
    const view = deriveContractView(unsignedContractPayload);
    expect(view.signed).toBe(false);
    expect(view.signatureImage).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// P-63 — post-signed footer variant + PDF download
// ---------------------------------------------------------------------------

describe("P-63 deriveContractView — signed footer variant and PDF url", () => {
  it("P-63 a signed contract selects the post-signed footer variant (no 'Questions before signing?')", () => {
    const view = deriveContractView(signedContractPayload);
    expect(view.footerVariant).toBe("signed");
  });

  it("P-63 an unsigned contract keeps the before-signing footer", () => {
    const view = deriveContractView(unsignedContractPayload);
    expect(view.footerVariant).toBe("beforeSigning");
  });

  it("P-63 a signed contract exposes its PDF download url (invoice precedent: /api/invoices/:id/pdf)", () => {
    const view = deriveContractView(signedContractPayload);
    expect(view.pdfUrl).toBe(
      `/api/contracts/${signedContractPayload.id}/pdf`,
    );
  });

  it("P-63 an unsigned contract offers no PDF url", () => {
    const view = deriveContractView(unsignedContractPayload);
    expect(view.pdfUrl).toBeUndefined();
  });
});
