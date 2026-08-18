/**
 * Public document state over the REAL API (dev stack on :5280 → :4280).
 *
 *   P-11 "The public quote has no persisted accepted state." — the public
 *        payload must carry who accepted + when, and a second accept must
 *        be rejected with 409 (today it 200s {ok:true,alreadyAccepted:true}).
 *        NOTE decline-after-accept already returns 409 before mutating
 *        (probed) — that guard is green, so it is NOT re-asserted here; the
 *        remaining decline defect is FE-only (errors only after submit).
 *   P-13 "The contract never names the customer: 'Para: —'." — a contract
 *        created without customerId (exactly what the assistant wizard
 *        produces — backend/src/agents/domain/coordinators/
 *        handle-wizard-answer/mod.ts omits it when the conversation has
 *        none) must still expose the customer block on GET
 *        /contracts/:id/public by falling back to the linked quote's
 *        customer. Probed today: the payload has NO customer key at all.
 *   P-40 the signed public payload must carry the stored signature image
 *        (redactContract explicitly omits customerSignature today).
 *   P-63 GET /contracts/:id/pdf must exist for a signed contract — the
 *        invoice precedent GET /invoices/:id/pdf was probed at
 *        200 application/pdf; the contract equivalent 404s today.
 */
import {
  anonymous,
  type ApiSession,
  contractor,
  seedCustomer,
  seedQuote,
} from "./helpers/api";

const CUSTOMER_NAME = "Maria Delgado";

/** Tiny valid 8×8 PNG — same kind of data URL PublicSignContract submits. */
const SIGNATURE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR4nGNgYGD4z4AGmNAFRlgIXQAAiMkBB9dzbnMAAAAASUVORK5CYII=";

describe("public doc state (quote accept persistence, contract customer/signature/pdf)", () => {
  let s: ApiSession;
  let customerId: string;

  beforeAll(async () => {
    s = await contractor("+15125552540");
    customerId = await seedCustomer(s, {
      name: CUSTOMER_NAME,
      email: "maria.delgado.jest@blackhole.postmarkapp.com",
      phoneNumber: "+15125552541",
    });
  });

  // -------------------------------------------------------------------------
  // P-11 — accepted state must be readable from the public payload
  // -------------------------------------------------------------------------

  describe("P-11 public quote carries its persisted accepted state", () => {
    let quoteId: string;

    beforeAll(async () => {
      quoteId = await seedQuote(s, { customerId });
      const accept = await anonymous().post(`/quotes/${quoteId}/accept`, {
        name: CUSTOMER_NAME,
        signature: CUSTOMER_NAME,
      });
      expect(accept.status).toBeLessThan(400);
    });

    it("P-11 GET /quotes/:id/public after accept carries status AND who accepted + when", async () => {
      const { status, body } = await anonymous().get(
        `/quotes/${quoteId}/public`,
      );
      expect(status).toBe(200);
      // Green today — the terminal status does come through:
      expect(body.status).toBe("approved");
      // RED today — the accept handler stores acceptedName + acceptedAt on
      // the row, but redactQuote drops both, so the page cannot render the
      // "accepted by X on Y" confirmation:
      expect(body.acceptedName).toBe(CUSTOMER_NAME);
      expect(typeof body.acceptedAt).toBe("string");
      expect(new Date(body.acceptedAt).toString()).not.toBe("Invalid Date");
    });

    it("P-11 a second accept attempt is rejected with 409 (no silent re-accept)", async () => {
      const second = await anonymous().post(`/quotes/${quoteId}/accept`, {
        name: "Someone Else",
        signature: "Someone Else",
      });
      // RED today: the endpoint answers 200 {ok:true,alreadyAccepted:true},
      // which lets the reloaded pristine form "accept" again as if it worked.
      expect(second.status).toBe(409);
    });
  });

  // -------------------------------------------------------------------------
  // P-13 — the public contract names the customer
  // -------------------------------------------------------------------------

  describe("P-13 public contract carries the customer block", () => {
    let quoteId: string;
    let contractId: string;

    beforeAll(async () => {
      quoteId = await seedQuote(s, { customerId });
      // Created WITHOUT customerId — the shape the assistant wizard's
      // contract-creation actually produces (it omits customerId when the
      // conversation has none). The quote it links DOES carry the customer.
      const r = await s.post("/contracts", { quoteId, totalAmount: 55000 });
      expect(r.status).toBeLessThan(400);
      contractId = r.body.id as string;
    });

    it("P-13 GET /contracts/:id/public includes the customer's name (via the linked quote)", async () => {
      const { status, body } = await anonymous().get(
        `/contracts/${contractId}/public`,
      );
      expect(status).toBe(200);
      // RED today: the payload has no `customer` key at all for this
      // contract shape, so the /c page renders "Para: —".
      expect(body.customer).toBeDefined();
      expect(body.customer.name).toBe(CUSTOMER_NAME);
    });
  });

  // -------------------------------------------------------------------------
  // P-40 + P-63 — signed contract: signature image + PDF download
  // -------------------------------------------------------------------------

  describe("P-40/P-63 signed public contract", () => {
    let quoteId: string;
    let contractId: string;

    beforeAll(async () => {
      quoteId = await seedQuote(s, { customerId });
      const r = await s.post("/contracts", {
        quoteId,
        customerId,
        totalAmount: 55000,
      });
      expect(r.status).toBeLessThan(400);
      contractId = r.body.id as string;
      const sign = await anonymous().post(`/contracts/${contractId}/sign`, {
        signature: SIGNATURE_PNG,
        name: CUSTOMER_NAME,
      });
      expect(sign.status).toBeLessThan(400);
    });

    it("P-40 GET /contracts/:id/public carries the stored signature image after signing", async () => {
      const { status, body } = await anonymous().get(
        `/contracts/${contractId}/public`,
      );
      expect(status).toBe(200);
      // Green today — the typed legal name survives:
      expect(body.customerSignedName).toBe(CUSTOMER_NAME);
      // RED today — redactContract omits the captured PNG, so neither the
      // signed page nor anything else can ever render the drawn signature.
      // Accept the data URL itself or a fetchable URL to it.
      const image = body.customerSignature ?? body.signatureImage ??
        body.signatureUrl;
      expect(image).toBeTruthy();
      expect(String(image)).toMatch(/^data:image\/|^https?:\/\/|^\//);
    });

    it("P-63 GET /contracts/:id/pdf serves the signed agreement as a PDF (invoice parity)", async () => {
      // Precedent (probed green): GET /invoices/:id/pdf → 200 application/pdf.
      // RED today: the contract equivalent 404s.
      const { status, res } = await anonymous().get(
        `/contracts/${contractId}/pdf`,
      );
      expect(status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/pdf");
    });
  });
});
