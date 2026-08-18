/**
 * P-35 [PLATFORM] "Auth/not-found errors serialize as HTTP 500."
 * P-09 [OUTBOUND] "Sends report success when delivery failed."
 *
 * P-35: UnauthorizedError / NotFoundError thrown by the backend (see
 * backend/src/users/domain/coordinators/require-user/mod.ts:6-11) reach the
 * wire as HTTP 500, so islands can't tell "logged out" from "server broke".
 * Live-probed 2026-08-18 (all RED cases below):
 *   - unauth GET /me            → 500
 *   - unauth GET /quotes        → 500 {"name":"UnauthorizedError","status":500,"message":"unauthorized"}
 *   - unauth GET /customers     → 500
 *   - authed GET /quotes/<uuid> → 500 {"name":"NotFoundError","status":500,"message":"quote … not found"}
 *   - authed GET /invoices/<uuid> → 500 (same shape, resource "invoice")
 * Desired: 401 for unauthenticated, 404 for missing resources.
 *
 * P-09 backend half: POST /invoices/:id/email for a customer with NO email.
 * Live-probed 2026-08-18 — the backend is ALREADY honest at the API level:
 *   → HTTP 200 {"ok":false,"reason":"no recipient: pass `to` or attach a
 *     customer with an email","to":"","subject":"Invoice #… from …"}
 *   → nothing appears in GET /messages for the invoice (a SUCCESSFUL send
 *     logs {channel:"email", paperworkId:<invoiceId>, subject}) and the
 *     invoice record is unchanged.
 * The "P-09" tests below are therefore GREEN TODAY by design: they PIN the
 * backend contract the front-end fix must consume (the RED half of P-09
 * lives in jest/unit/send-result.test.ts and
 * cypress/e2e/invoice-send-honesty.cy.ts — the UI ignores this body today).
 */
import { randomUUID } from "crypto";
import {
  anonymous,
  contractor,
  seedCustomer,
  seedInvoice,
  type ApiSession,
} from "./helpers/api";

describe("P-35 unauthenticated API fetches return 401 (not 500)", () => {
  it("P-35 unauthenticated GET /me → 401", async () => {
    const { status } = await anonymous().get("/me");
    expect(status).toBe(401);
  });

  it("P-35 unauthenticated GET /quotes → 401", async () => {
    const { status, body } = await anonymous().get("/quotes");
    expect(status).toBe(401);
    // The serialized error must not claim status 500 either.
    if (body && typeof body === "object") {
      expect(body.status).not.toBe(500);
    }
  });

  it("P-35 unauthenticated GET /customers → 401", async () => {
    const { status } = await anonymous().get("/customers");
    expect(status).toBe(401);
  });
});

describe("P-35 missing resources return 404 (not 500)", () => {
  let s: ApiSession;

  beforeAll(async () => {
    s = await contractor("+15125552430");
  });

  it("P-35 authed GET /quotes/<random-uuid> → 404", async () => {
    const { status, body } = await s.get(`/quotes/${randomUUID()}`);
    expect(status).toBe(404);
    if (body && typeof body === "object") {
      expect(body.status).not.toBe(500);
    }
  });

  it("P-35 authed GET /invoices/<random-uuid> → 404", async () => {
    const { status } = await s.get(`/invoices/${randomUUID()}`);
    expect(status).toBe(404);
  });
});

describe("P-09 backend contract: failed invoice email is machine-distinguishable and records nothing as sent", () => {
  let s: ApiSession;
  let customerId: string;
  let invoiceId: string;

  beforeAll(async () => {
    s = await contractor("+15125552431");
    // JSON.stringify drops undefined values, so this customer is created
    // with NO email and NO phone — the live-proven delivery-failure case.
    customerId = await seedCustomer(s, {
      name: "No Contact Nancy",
      email: undefined,
      phoneNumber: undefined,
    });
    invoiceId = await seedInvoice(s, { customerId, status: "sent" });
  });

  it("P-09 POST /invoices/:id/email → failure the FE can detect (status>=400 OR body.ok===false with a reason) [GREEN today — contract pin]", async () => {
    const { status, body } = await s.post(`/invoices/${invoiceId}/email`);
    const machineDistinguishable = status >= 400 ||
      (body?.ok === false && typeof body?.reason === "string" &&
        body.reason.length > 0);
    expect(machineDistinguishable).toBe(true);
    // Under no circumstances may the body claim success.
    expect(body?.ok).not.toBe(true);
  });

  it("P-09 the failed send records NO successful email: invoice unchanged, no email message logged [GREEN today — contract pin]", async () => {
    // Invoice record: still exactly the status it was created with; no
    // delivery stamp appeared.
    const inv = await s.get(`/invoices/${invoiceId}`);
    expect(inv.status).toBeLessThan(400);
    expect(inv.body?.status).toBe("sent"); // unchanged from creation
    expect(inv.body?.emailedAt).toBeUndefined();
    expect(inv.body?.deliveredAt).toBeUndefined();

    // Communication log: a SUCCESSFUL invoice email logs
    // {channel:"email", paperworkId:<invoiceId>} (live-proven); a failed one
    // must log no email-channel record for this invoice.
    const { body } = await s.get("/messages");
    const all: Array<Record<string, unknown>> = Array.isArray(body)
      ? body
      : body?.items ?? [];
    const emailForInvoice = all.filter((m) =>
      (m.channel === "email" || m.kind === "email") &&
      JSON.stringify(m).includes(invoiceId)
    );
    expect(emailForInvoice).toHaveLength(0);
  });
});
