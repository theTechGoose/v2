/**
 * REQ-655 — demo-loop cycle 5, issues M12 + p18-9c: extra work on a job whose
 * every invoice is paid.
 *
 *  - p18-9c (pair 9): on /quotes, Q-001's "New change order" button showed
 *    on a fully paid job and only AFTER the click said "Every invoice on this
 *    job is paid, so a change order has nowhere to go", with a bare
 *    "/invoices?new=1" link — a blank invoice, not linked to the job.
 *  - M12 (pair 2): the chat said "create its invoice first" for a job whose
 *    INV-001 existed and was paid.
 *
 *   shared/documents/change-order-actions.ts  newChangeOrderButton,
 *                                             extraWorkInvoiceHref,
 *                                             isExtraWorkLink
 *   shared/documents/invoice-form.ts          buildInvoiceBody (extraWork)
 *   front-end/islands/QuotesPage.tsx          "Bill extra work" up front
 *   front-end/islands/InvoicesPage.tsx        ?quoteId=&extra=1 honoured
 *   front-end/lib/chat-quote-link.ts          the chat's new invoice links Q-001
 *
 * Lazy-required so a missing export reds only the tests that use it.
 */
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const actions = () => require("../../shared/documents/change-order-actions");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const form = () => require("../../shared/documents/invoice-form");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const link = () => require("../../front-end/lib/chat-quote-link");

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json"));
const es = JSON.parse(read("lang/es.json"));

describe("REQ-655 (p18-9c) the quote panel's button on a fully paid job", () => {
  it("REQ-655 every invoice paid → 'Bill extra work', straight to a new invoice linked to the job", () => {
    const { newChangeOrderButton } = actions();
    expect(newChangeOrderButton({ kind: "new_invoice" }, "q 1")).toEqual({
      labelKey: "quotes.ledger.billExtraWork",
      href: "/invoices?new=1&quoteId=q%201&extra=1",
    });
  });

  it("REQ-655 an open invoice or nothing invoiced yet keeps 'New change order' (it opens the panel)", () => {
    const { newChangeOrderButton } = actions();
    for (
      const target of [
        { kind: "invoice", invoiceId: "i1", invoiceNumber: "INV-001" },
        { kind: "invoice_first" },
      ]
    ) {
      expect(newChangeOrderButton(target, "q1")).toEqual({
        labelKey: "quotes.ledger.newChangeOrder",
        href: null,
      });
    }
  });

  it("REQ-655 the extra-work link is read back by the invoices page", () => {
    const { extraWorkInvoiceHref, isExtraWorkLink } = actions();
    expect(extraWorkInvoiceHref("q1")).toBe(
      "/invoices?new=1&quoteId=q1&extra=1",
    );
    expect(isExtraWorkLink("?new=1&quoteId=q1&extra=1")).toBe(true);
    expect(isExtraWorkLink("?new=1&quoteId=q1")).toBe(false);
    expect(isExtraWorkLink("?new=1&extra=1")).toBe(false);
  });

  it("REQ-655 the label reads 'Bill extra work' / 'Cobrar trabajo extra'", () => {
    expect(en["quotes.ledger.billExtraWork"]).toBe("Bill extra work");
    expect(es["quotes.ledger.billExtraWork"]).toBe("Cobrar trabajo extra");
  });

  it("REQ-655 QuotesPage decides the button BEFORE rendering it, and never sends the paid job to a bare /invoices?new=1", () => {
    const src = read("front-end/islands/QuotesPage.tsx");
    expect(src).toMatch(/newChangeOrderButton\(/);
    expect(src).toMatch(/data-cy="quote-bill-extra-work"/);
    expect(src).not.toMatch(/:\s*"\/invoices\?new=1"/);
  });
});

describe("REQ-655 (p18-9c) the new invoice drawn from a paid job", () => {
  const base = {
    customerId: "c1",
    quoteId: "q1",
    jobName: "Hedge trim",
    description: "",
    lineItems: [],
    amountCents: 4_500,
    discountCents: 0,
    discountReason: "",
    taxRateBp: 0,
    netDays: 15,
    issuedDate: "2026-11-12",
    dueDate: "2026-11-27",
    serviceAddress: "",
    paymentInstructions: "",
    billTo: {},
  };

  it("REQ-655 extra work bills its own one line and says so (override), so the agreement cap does not refuse it", () => {
    const { buildInvoiceBody } = form();
    const body = buildInvoiceBody(
      { ...base, extraWork: true },
      { requestId: "r1", status: "draft" },
    );
    expect(body.quoteId).toBe("q1");
    expect(body.customerId).toBe("c1");
    expect(body.override).toBe(true);
    expect(body.amount).toBe(4_500);
    expect(body.lineItems).toEqual([{
      description: "Hedge trim",
      quantity: 1,
      price: 4_500,
    }]);
  });

  it("REQ-655 an ordinary quote-drawn invoice is unchanged: no override, the backend derives the quote's lines", () => {
    const { buildInvoiceBody } = form();
    const body = buildInvoiceBody(base, { requestId: "r1", status: "draft" });
    expect(body.override).toBeUndefined();
    expect(body.lineItems).toBeUndefined();
  });

  it("REQ-655 InvoicesPage reads ?extra=1 and builds the body with extraWork", () => {
    const src = read("front-end/islands/InvoicesPage.tsx");
    expect(src).toMatch(/isExtraWorkLink\(/);
    expect(src).toMatch(/extraWork[,:]/);
  });
});

describe("REQ-655 (M12) the chat's reply on a paid job", () => {
  it("REQ-655 a new invoice (or an all-paid credit) links back to the job", () => {
    const { chatQuoteLink } = link();
    for (const kind of ["new_invoice", "all_paid"]) {
      expect(
        chatQuoteLink({
          changeOrder: { kind, quoteId: "q1", quoteNumber: "Q-001" },
        }),
      ).toEqual({ quoteId: "q1", quoteNumber: "Q-001", publish: false });
    }
  });

  it("REQ-655 the replies exist in en and es with the same placeholders", () => {
    for (
      const key of [
        "chatCoordinator.changeOrder.newInvoice",
        "chatCoordinator.changeOrder.allPaid",
      ]
    ) {
      expect(typeof en[key]).toBe("string");
      expect(typeof es[key]).toBe("string");
      const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(vars(es[key])).toEqual(vars(en[key]));
      expect(en[key]).toMatch(/\{paid\}/);
    }
  });
});
