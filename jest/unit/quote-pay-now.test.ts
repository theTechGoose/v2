/**
 * REQ-251 — demo issue quote-invoice-money-m13: a signed quote hands the
 * customer straight to payment. Once the agreement is accepted and an
 * invoice billed against it is open (sent / viewed, balance owed), the
 * public /q page shows a primary "Pay now $X" button linking that invoice's
 * public page (/i/:id). Before this, the signed page showed only the small
 * "Related documents · INV-001" row — no pay hand-off at all.
 *
 *   shared/documents/linked-view.ts → payNowTarget()
 *   front-end/components/quote-doc.tsx → renders it (data-cy="quote-pay-now")
 *   lang/{en,es}.json → quoteDoc.payNow
 */
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const lv = () => require("../../shared/documents/linked-view");

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const inv = (over: Record<string, unknown> = {}) => ({
  id: "inv-1",
  number: "INV-001",
  url: "/i/inv-1",
  status: "sent",
  amountCents: 480000,
  paidCents: 0,
  balanceCents: 480000,
  ...over,
});

describe("REQ-251 payNowTarget — the invoice a signed quote's Pay button opens", () => {
  it("REQ-251 an accepted quote with a sent, unpaid invoice points at that invoice's public page and balance", () => {
    const { payNowTarget } = lv();
    expect(
      payNowTarget({ status: "accepted", invoices: [inv()] }),
    ).toEqual({
      invoiceId: "inv-1",
      number: "INV-001",
      url: "/i/inv-1",
      balanceCents: 480000,
    });
  });

  it("REQ-251 a quote that is not accepted gets no Pay button, even with an open invoice", () => {
    const { payNowTarget } = lv();
    expect(payNowTarget({ status: "sent", invoices: [inv()] })).toBeUndefined();
    expect(payNowTarget({ status: "lost", invoices: [inv()] })).toBeUndefined();
  });

  it("REQ-251 the state 'accepted' alone also counts as signed", () => {
    const { payNowTarget } = lv();
    expect(payNowTarget({ state: "accepted", invoices: [inv()] })?.invoiceId)
      .toBe("inv-1");
  });

  it("REQ-251 paid, claimed, void, scheduled and draft invoices are not payable; a zero balance is not", () => {
    const { payNowTarget } = lv();
    for (const status of ["paid", "claimed", "void", "scheduled", "draft"]) {
      expect(
        payNowTarget({ status: "accepted", invoices: [inv({ status })] }),
      ).toBeUndefined();
    }
    expect(
      payNowTarget({
        status: "accepted",
        invoices: [inv({ balanceCents: 0, paidCents: 480000 })],
      }),
    ).toBeUndefined();
  });

  it("REQ-251 the first open installment wins (the list is already in number order); a viewed invoice is payable", () => {
    const { payNowTarget } = lv();
    const t = payNowTarget({
      status: "accepted",
      invoices: [
        inv({
          id: "a",
          number: "INV-001",
          url: "/i/a",
          status: "paid",
          balanceCents: 0,
        }),
        inv({
          id: "b",
          number: "INV-002",
          url: "/i/b",
          status: "viewed",
          balanceCents: 120000,
        }),
        inv({ id: "c", number: "INV-003", url: "/i/c", status: "sent" }),
      ],
    });
    expect(t).toEqual({
      invoiceId: "b",
      number: "INV-002",
      url: "/i/b",
      balanceCents: 120000,
    });
  });

  it("REQ-251 a row with no url links /i/:id; a row with no balance falls back to amount − paid", () => {
    const { payNowTarget } = lv();
    expect(
      payNowTarget({
        status: "accepted",
        invoices: [{
          id: "z",
          number: "INV-009",
          status: "sent",
          amountCents: 5000,
          paidCents: 1000,
        }],
      }),
    ).toEqual({
      invoiceId: "z",
      number: "INV-009",
      url: "/i/z",
      balanceCents: 4000,
    });
  });
});

describe("REQ-251 the signed quote page renders the Pay now button", () => {
  const doc = read("front-end/components/quote-doc.tsx");

  it("REQ-251 quote-doc.tsx derives the target with payNowTarget and renders data-cy='quote-pay-now' linking its url", () => {
    expect(doc).toMatch(/payNowTarget\(/);
    expect(doc).toMatch(/data-cy="quote-pay-now"/);
    expect(doc).toMatch(/href=\{payNow\.url\}/);
    expect(doc).toMatch(/quoteDoc\.payNow/);
  });

  it("REQ-251 both languages carry quoteDoc.payNow with the {amount} slot", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    expect(en["quoteDoc.payNow"]).toBe("Pay now {amount}");
    expect(es["quoteDoc.payNow"]).toBe("Pagar ahora {amount}");
  });
});
