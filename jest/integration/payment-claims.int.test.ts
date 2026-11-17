/**
 * REQ-281 (demo M34): a customer's payment claim is an attention item on
 * /payments until the contractor confirms or rejects it.
 *
 * Over the dev stack: the public claim leaves NO Payment row (so /payments
 * built from GET /payments alone shows nothing — the bug), but GET /invoices
 * carries the claim; the page's own derivation (pendingClaims) over that live
 * payload yields exactly one attention item, and confirm / reject each clear
 * it.
 *
 * Phones: +15125556281 (reserved for REQ-281).
 */
import {
  anonymous,
  type ApiSession,
  contractor,
  seedInvoice,
} from "./helpers/api";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const lib = () => require("../../front-end/lib/payment-claims");

const today = new Date().toISOString().slice(0, 10);

describe("REQ-281 M34 a payment claim reaches /payments' attention track", () => {
  let s: ApiSession;

  beforeAll(async () => {
    s = await contractor("+15125556281");
  });

  async function claimsFor(invoiceId: string) {
    const invoices = (await s.get("/invoices")).body;
    return lib()
      .pendingClaims(invoices, new Map(), new Date())
      .filter((c: { invoiceId: string }) => c.invoiceId === invoiceId);
  }

  it("REQ-281 a Zelle claim is not a Payment row, but the invoice list carries it and the page derives one attention item", async () => {
    const invoiceId = await seedInvoice(s, {
      amount: 42000,
      status: "sent",
      issuedDate: today,
    });
    const claim = await anonymous().post(
      `/invoices/${invoiceId}/claim-payment`,
      {
        method: "zelle",
        reference: "ZL-281",
        claimedBy: "María Pagadora",
      },
    );
    expect(claim.status).toBe(200);

    // the claim is not a payment yet — which is why /payments read nothing
    const rows = await s.get(`/payments?invoiceId=${invoiceId}`);
    expect(rows.body).toHaveLength(0);

    const claims = await claimsFor(invoiceId);
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      method: "zelle",
      amount: 42000,
      reference: "ZL-281",
      claimedBy: "María Pagadora",
    });
  });

  it("REQ-281 confirming the claim clears the attention item and lands a Payment row", async () => {
    const invoiceId = await seedInvoice(s, {
      amount: 30000,
      status: "sent",
      issuedDate: today,
    });
    await anonymous().post(`/invoices/${invoiceId}/claim-payment`, {
      method: "zelle",
    });
    expect(await claimsFor(invoiceId)).toHaveLength(1);

    const confirm = await s.post(`/invoices/${invoiceId}/confirm-payment`);
    expect(confirm.status).toBe(200);
    expect(await claimsFor(invoiceId)).toHaveLength(0);
    const rows = await s.get(`/payments?invoiceId=${invoiceId}`);
    expect(rows.body).toHaveLength(1);
    expect(rows.body[0].method).toBe("zelle");
  });

  it("REQ-281 rejecting the claim clears the attention item and records no payment", async () => {
    const invoiceId = await seedInvoice(s, {
      amount: 30000,
      status: "sent",
      issuedDate: today,
    });
    await anonymous().post(`/invoices/${invoiceId}/claim-payment`, {
      method: "venmo",
    });
    expect(await claimsFor(invoiceId)).toHaveLength(1);

    const reject = await s.post(`/invoices/${invoiceId}/reject-claim`);
    expect(reject.status).toBe(200);
    expect(await claimsFor(invoiceId)).toHaveLength(0);
    const rows = await s.get(`/payments?invoiceId=${invoiceId}`);
    expect(rows.body).toHaveLength(0);
  });
});
