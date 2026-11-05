/**
 * REQ-167 / REQ-168 / REQ-169 — the invoice polish of 2026-11-05: a per-invoice delete with an
 * inline confirm, the business website on every invoice surface, and bill copy that thanks the
 * customer instead of "Thanks for the work".
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-167 each invoice has a Delete with an inline confirm", () => {
  const src = read("front-end/islands/InvoicesPage.tsx");
  test("the detail card and the list card carry a delete that asks first, then DELETEs /api/invoices/:id", () => {
    expect(src).toMatch(/data-cy="invoice-delete"/);
    expect(src).toMatch(/data-cy="invoice-delete-confirm"/);
    expect(src).toMatch(/data-cy="invoice-card-delete"/);
    expect(src).toMatch(/data-cy="invoice-card-delete-confirm"/);
    expect(src).toMatch(
      /fetch\(`\/api\/invoices\/\$\{inv\.id\}`,\s*\{\s*method:\s*"DELETE"/,
    );
    expect(src).not.toMatch(/\bconfirm\(/); // no browser dialogs
  });
  test("the labels exist in both languages", () => {
    for (
      const k of [
        "deleteBtn",
        "deleteAsk",
        "deleteYes",
        "deleteNo",
        "errDelete",
      ]
    ) {
      expect(en[`invoicesPage.detail.${k}`]).toBeTruthy();
      expect(es[`invoicesPage.detail.${k}`]).toBeTruthy();
    }
  });
});

describe("REQ-168 the business website is on the invoice page, the invoice email and the PDF", () => {
  test("the public invoice page links the website in the business header", () => {
    const src = read("front-end/routes/i/[id].tsx");
    expect(src).toMatch(/websiteUrl\?: string/);
    expect(src).toMatch(/data-cy="invoice-website"/);
  });
  test("the email shell's From block carries the website", () => {
    const src = read(
      "backend/src/paperwork/domain/coordinators/send-paperwork-email/mod.ts",
    );
    expect(src).toMatch(/website\?: string;/);
    expect(src).toMatch(/website: senderBiz\?\.websiteUrl/);
  });
  test("the invoice PDF's From lines carry the website", () => {
    const src = read(
      "backend/src/paperwork/domain/coordinators/render-invoice-pdf/mod.ts",
    );
    expect(src).toMatch(/ident\?\.websiteUrl/);
  });
});

describe("REQ-169 the bill thanks the customer properly", () => {
  test("no invoice surface says 'Thanks for the work' or 'I look forward to working with you' any more", () => {
    for (const d of [en, es]) {
      expect(d["paperworkEmail.invoice.intro"]).not.toMatch(
        /Thanks for the work|Gracias por el trabajo/,
      );
      expect(d["publicInvoice.footer.closing"]).not.toMatch(
        /look forward|Espero poder/,
      );
      expect(d["paperworkSms.body.invoiceClosing"]).toBeTruthy();
      expect(d["publicInvoice.footer.thanks"]).toMatch(/\{business\}/);
      expect(d["paperworkEmail.invoice.intro"]).toMatch(/\{business\}/);
    }
    expect(en["publicInvoice.footer.thanks"]).toMatch(
      /Thank you for trusting \{business\}/,
    );
    expect(es["publicInvoice.footer.thanks"]).toMatch(
      /Gracias por confiar en \{business\}/,
    );
  });
  test("the public page renders the thanks line and the SMS invoice body uses its own closing", () => {
    expect(read("front-end/routes/i/[id].tsx")).toMatch(
      /publicInvoice\.footer\.thanks/,
    );
    expect(
      read(
        "backend/src/paperwork/domain/coordinators/send-paperwork-sms/mod.ts",
      ),
    ).toMatch(/paperworkSms\.body\.invoiceClosing/);
  });
});
