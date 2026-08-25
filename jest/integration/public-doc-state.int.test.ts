/**
 * Public document state over the REAL API (dev stack on :5280 → :4280) —
 * merged-world edition. The quote IS the Quote + Agreement, so every public
 * document guarantee lives on GET /quotes/:id/public + /quotes/:id/pdf.
 *
 *   P-11 the public payload carries the persisted accepted state (who +
 *        when), and a second accept is rejected with 409.
 *   P-13 the public quote names the customer — the full contact projection
 *        ({name, phoneNumber, email}) backs the agreement's To/Para card.
 *   P-40 the accepted public payload carries the stored signature image.
 *   P-63 GET /quotes/:id/pdf serves the agreement as a PDF (invoice parity).
 */
import {
  anonymous,
  type ApiSession,
  contractor,
  seedCustomer,
  seedQuote,
} from "./helpers/api";

const CUSTOMER_NAME = "Maria Delgado";

/** Tiny valid 8×8 PNG — same kind of data URL PublicSignQuote submits. */
const SIGNATURE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR4nGNgYGD4z4AGmNAFRlgIXQAAiMkBB9dzbnMAAAAASUVORK5CYII=";

describe("public doc state (accept persistence, customer block, signature, pdf)", () => {
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
      // The one canonical terminal value — "approved" is dead.
      expect(body.status).toBe("accepted");
      expect(body.acceptedName).toBe(CUSTOMER_NAME);
      expect(typeof body.acceptedAt).toBe("string");
      expect(new Date(body.acceptedAt).toString()).not.toBe("Invalid Date");
    });

    it("P-11 a second accept attempt is rejected with 409 (no silent re-accept)", async () => {
      const second = await anonymous().post(`/quotes/${quoteId}/accept`, {
        name: "Someone Else",
        signature: "Someone Else",
      });
      expect(second.status).toBe(409);
      expect(second.body.reason).toBe("already_accepted");
    });
  });

  // -------------------------------------------------------------------------
  // P-13 — the public quote names the customer (the agreement's To card)
  // -------------------------------------------------------------------------

  describe("P-13 public quote carries the customer block", () => {
    let quoteId: string;

    beforeAll(async () => {
      quoteId = await seedQuote(s, { customerId });
    });

    it("P-13 GET /quotes/:id/public includes the customer's contact projection", async () => {
      const { status, body } = await anonymous().get(
        `/quotes/${quoteId}/public`,
      );
      expect(status).toBe(200);
      expect(body.customer).toBeDefined();
      expect(body.customer.name).toBe(CUSTOMER_NAME);
      // The merged agreement renders a full To/Para contact card, so the
      // projection is {name, phoneNumber, email} — not name alone.
      expect(body.customer.phoneNumber).toBe("+15125552541");
      expect(body.customer.email).toBe(
        "maria.delgado.jest@blackhole.postmarkapp.com",
      );
    });
  });

  // -------------------------------------------------------------------------
  // P-40 + P-63 — accepted quote: signature image + PDF download
  // -------------------------------------------------------------------------

  describe("P-40/P-63 accepted public quote", () => {
    let quoteId: string;

    beforeAll(async () => {
      quoteId = await seedQuote(s, { customerId });
      const accept = await anonymous().post(`/quotes/${quoteId}/accept`, {
        signature: SIGNATURE_PNG,
        name: CUSTOMER_NAME,
      });
      expect(accept.status).toBeLessThan(400);
    });

    it("P-40 GET /quotes/:id/public carries the stored signature image after accepting", async () => {
      const { status, body } = await anonymous().get(
        `/quotes/${quoteId}/public`,
      );
      expect(status).toBe(200);
      expect(body.acceptedName).toBe(CUSTOMER_NAME);
      expect(body.acceptedSignature).toBeTruthy();
      expect(String(body.acceptedSignature)).toMatch(
        /^data:image\/|^https?:\/\/|^\//,
      );
    });

    it("P-63 GET /quotes/:id/pdf serves the agreement as a PDF (invoice parity)", async () => {
      const { status, res } = await anonymous().get(`/quotes/${quoteId}/pdf`);
      expect(status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/pdf");
    });
  });
});
