/**
 * PDF p18 (Invoices — "This is not working.") over the REAL API:
 *   - adjust via POST /invoices/:id/discount → total reduced
 *   - adjust via POST /invoices/:id/change-orders → a NEW public approval
 *     page (/co/:id) per change order; the change does NOT apply until the
 *     customer approves it
 *   - customer approves at POST /change-orders/:id/approve → invoice updates
 *
 * Field vocabulary pinned to the shipped DTOs: invoices carry `amount`
 * (integer cents, dto/invoice.ts); discounts take `discountCents` and CLAMP
 * at zero; change orders take { description, deltaAmountCents }
 * (dto/change-order.ts).
 */
import {
  anonymous,
  type ApiSession,
  contractor,
  seedInvoice,
} from "./helpers/api";

describe("invoice adjustments — discount", () => {
  let s: ApiSession;
  let invoiceId: string;

  beforeAll(async () => {
    s = await contractor("+15125550914");
    invoiceId = await seedInvoice(s);
  });

  it("applies a discount and reduces the amount", async () => {
    const r = await s.post(`/invoices/${invoiceId}/discount`, {
      discountCents: 5000,
      reason: "Repeat client",
    });
    expect(r.status).toBeLessThan(400);
    const { body } = await s.get(`/invoices/${invoiceId}`);
    expect(body.amount).toBe(50000);
    expect(body.discountCents).toBe(5000);
  });

  it("an oversized discount clamps the amount at zero (never negative)", async () => {
    const inv = await seedInvoice(s);
    const r = await s.post(`/invoices/${inv}/discount`, {
      discountCents: 999999,
    });
    expect(r.status).toBeLessThan(400);
    const { body } = await s.get(`/invoices/${inv}`);
    expect(body.amount).toBe(0);
  });
});

describe("invoice adjustments — change orders need customer approval", () => {
  let s: ApiSession;
  let invoiceId: string;
  let changeOrderId: string;

  beforeAll(async () => {
    s = await contractor("+15125550915");
    invoiceId = await seedInvoice(s);
  });

  it("creating a change order returns a pending order addressable at /co/:id", async () => {
    const r = await s.post(`/invoices/${invoiceId}/change-orders`, {
      description: "Haul extra debris",
      deltaAmountCents: 15000,
    });
    expect(r.status).toBeLessThan(400);
    changeOrderId = r.body.id;
    expect(changeOrderId).toBeTruthy();
    expect(r.body.status).toBe("pending");
  });

  it("the pending change order does NOT change the invoice amount yet", async () => {
    const { body } = await s.get(`/invoices/${invoiceId}`);
    expect(body.amount).toBe(55000);
  });

  it("the customer can read the change order at its public endpoint", async () => {
    const { status, body } = await anonymous().get(
      `/change-orders/${changeOrderId}/public`,
    );
    expect(status).toBe(200);
    expect(body.deltaAmountCents ?? body.changeOrder?.deltaAmountCents).toBe(
      15000,
    );
  });

  it("customer approval applies the change order to the invoice", async () => {
    const approve = await anonymous().post(
      `/change-orders/${changeOrderId}/approve`,
      {
        name: "Green Goblin",
      },
    );
    expect(approve.status).toBeLessThan(400);
    const { body } = await s.get(`/invoices/${invoiceId}`);
    expect(body.amount).toBe(70000);
  });

  it("a declined change order never applies", async () => {
    const co = await s.post(`/invoices/${invoiceId}/change-orders`, {
      description: "Second extra",
      deltaAmountCents: 9900,
    });
    const decline = await anonymous().post(
      `/change-orders/${co.body.id}/decline`,
      {
        name: "Green Goblin",
      },
    );
    expect(decline.status).toBeLessThan(400);
    const { body } = await s.get(`/invoices/${invoiceId}`);
    expect(body.amount).toBe(70000); // unchanged from the approved state
  });

  it("each change order is its own approval target (a NEW /co link each time)", async () => {
    const a = await s.post(`/invoices/${invoiceId}/change-orders`, {
      description: "A",
      deltaAmountCents: 1000,
    });
    const b = await s.post(`/invoices/${invoiceId}/change-orders`, {
      description: "B",
      deltaAmountCents: 2000,
    });
    expect(a.body.id).toBeTruthy();
    expect(b.body.id).toBeTruthy();
    expect(a.body.id).not.toBe(b.body.id);
  });
});
