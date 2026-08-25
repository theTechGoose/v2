/**
 * Public-document view state, derived from the public payload
 * (GET /quotes/:id/public). Post Quote+Contract merge the quote IS the
 * agreement — /q/:id renders the full document and deriveQuoteView is the
 * SINGLE derive for the whole customer-facing doc (deriveContractView and
 * the separate /c page are gone).
 *
 *   P-11 a reloaded accepted /q/:id renders a persisted accepted state
 *        (who accepted, when), never the pristine accept form again.
 *   P-13 the agreement names the customer (payload.customer.name).
 *   P-40 the accepted view exposes the stored signature image
 *        (payload.acceptedSignature).
 *   P-63 accepted /q: post-accept footer variant + PDF download url
 *        (/api/quotes/:id/pdf — invoice precedent: /api/invoices/:id/pdf).
 *
 * Canonical accepted status is "accepted" (or a persisted acceptedAt stamp);
 * the legacy "approved" value is DEAD — nothing writes or reads it.
 *
 * Target: shared/quote-flow/public-doc-state.ts
 */
import { deriveQuoteView } from "../../shared/quote-flow/public-doc-state";

// ---------------------------------------------------------------------------
// Fixtures — the merged public payload shape (GET /quotes/:id/public):
// top-level quote fields incl. the acceptance evidence, plus the customer
// block. Trimmed to the fields deriveQuoteView reads.
// ---------------------------------------------------------------------------

/** GET /quotes/:id/public after POST /quotes/:id/accept. */
const acceptedQuotePayload = {
  id: "5546f5ed-7d11-4466-9533-afd4c1cf0438",
  status: "accepted", // ← the single canonical accepted value
  customer: { name: "Maria Probe" },
  acceptedName: "Maria Probe",
  acceptedAt: "2026-08-18T11:12:14.000Z",
  acceptedSignature:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR4nGNgYGD4z4AGmNAFRlgIXQAAiMkBB9dzbnMAAAAASUVORK5CYII=",
};

/** The same quote before anybody signed (open ceremony). */
const openQuotePayload = {
  id: acceptedQuotePayload.id,
  status: "sent",
  customer: { name: "Maria Probe" },
};

// ---------------------------------------------------------------------------
// P-11 — persisted accepted state on /q/:id
// ---------------------------------------------------------------------------

describe("P-11 deriveQuoteView — persisted accepted state on /q/:id", () => {
  it("P-11 an accepted payload yields mode 'accepted', never the open form", () => {
    const view = deriveQuoteView(acceptedQuotePayload);
    expect(view.mode).toBe("accepted");
    expect(view.mode).not.toBe("open");
  });

  it("P-11 the accepted view carries who accepted and when", () => {
    const view = deriveQuoteView(acceptedQuotePayload);
    expect(view.acceptedBy).toBe("Maria Probe");
    expect(view.acceptedAt).toBe("2026-08-18T11:12:14.000Z");
  });

  it("P-11 a persisted acceptedAt stamp is accepted even when the status lags", () => {
    // Defensive: the acceptance stamp alone must keep the page out of the
    // re-acceptance form (isAccepted = status==="accepted" || acceptedAt).
    const view = deriveQuoteView({
      ...acceptedQuotePayload,
      status: "sent",
    });
    expect(view.mode).toBe("accepted");
  });

  it("P-11 the dead legacy 'approved' status is NOT accepted (no dual tolerance)", () => {
    const { acceptedAt: _a, acceptedSignature: _s, ...rest } =
      acceptedQuotePayload;
    const view = deriveQuoteView({ ...rest, status: "approved" });
    expect(view.mode).not.toBe("accepted");
  });

  it("P-11 status 'accepted' is accepted even when the name/date fields are still missing", () => {
    const view = deriveQuoteView({
      id: acceptedQuotePayload.id,
      status: "accepted",
      customer: { name: "Maria Probe" },
    });
    expect(view.mode).toBe("accepted");
  });

  it("P-11 a declined payload (status 'lost') yields mode 'declined'", () => {
    const view = deriveQuoteView({ ...openQuotePayload, status: "lost" });
    expect(view.mode).toBe("declined");
  });

  it("P-11 an open payload (draft/sent/viewed) yields mode 'open'", () => {
    for (const status of ["draft", "sent", "viewed"]) {
      expect(deriveQuoteView({ ...openQuotePayload, status }).mode).toBe(
        "open",
      );
    }
  });
});

// ---------------------------------------------------------------------------
// P-13 — the agreement names the customer
// ---------------------------------------------------------------------------

describe("P-13 deriveQuoteView — the agreement names the customer", () => {
  it("P-13 exposes customerName from payload.customer.name (open)", () => {
    const view = deriveQuoteView(openQuotePayload);
    expect(view.customerName).toBe("Maria Probe");
  });

  it("P-13 exposes customerName after acceptance too", () => {
    const view = deriveQuoteView(acceptedQuotePayload);
    expect(view.customerName).toBe("Maria Probe");
  });
});

// ---------------------------------------------------------------------------
// P-40 — accepted view exposes the drawn signature image
// ---------------------------------------------------------------------------

describe("P-40 deriveQuoteView — accepted view carries the signature image", () => {
  it("P-40 signatureImage is the stored PNG data URL on an accepted quote", () => {
    const view = deriveQuoteView(acceptedQuotePayload);
    expect(view.mode).toBe("accepted");
    expect(view.signatureImage).toBe(acceptedQuotePayload.acceptedSignature);
    expect(view.signatureImage).toMatch(/^data:image\/png/);
  });

  it("P-40 an open quote has no signatureImage", () => {
    const view = deriveQuoteView(openQuotePayload);
    expect(view.mode).toBe("open");
    expect(view.signatureImage).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// P-63 — post-accept footer variant + PDF download
// ---------------------------------------------------------------------------

describe("P-63 deriveQuoteView — accepted footer variant and PDF url", () => {
  it("P-63 an accepted quote selects the post-signed footer variant (no 'Questions before signing?')", () => {
    const view = deriveQuoteView(acceptedQuotePayload);
    expect(view.footerVariant).toBe("signed");
  });

  it("P-63 an open quote keeps the before-signing footer", () => {
    const view = deriveQuoteView(openQuotePayload);
    expect(view.footerVariant).toBe("beforeSigning");
  });

  it("P-63 an accepted quote exposes its PDF download url (invoice precedent: /api/invoices/:id/pdf)", () => {
    const view = deriveQuoteView(acceptedQuotePayload);
    expect(view.pdfUrl).toBe(`/api/quotes/${acceptedQuotePayload.id}/pdf`);
  });

  it("P-63 an open quote offers no PDF url", () => {
    const view = deriveQuoteView(openQuotePayload);
    expect(view.pdfUrl).toBeUndefined();
  });

  it("P-63 a declined quote offers no PDF url either", () => {
    const view = deriveQuoteView({ ...openQuotePayload, status: "lost" });
    expect(view.pdfUrl).toBeUndefined();
  });
});
