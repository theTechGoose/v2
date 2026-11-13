/**
 * REQ-550 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 4 (run r857a9d67), issue B1: a $99,999,999 invoice
 * with no customer and no recipient was issued and listed as Sent; the
 * missing-info box did not block it.
 *
 * RCA (CONFIRMED, skeptic UPHELD at ad104a19): NewInvoiceModal.submit
 * (InvoicesPage.tsx:3586-3600) checked only total > 0, a due date and a new
 * client's name, so clientSel '' passed; canSend was false, and
 * newInvoiceStatus({ issue: true, dispatch: false }) returned "sent"
 * (invoice-form.ts:358). POST /invoices took it: customerId optional, amount
 * a bare @IsNumber, sentAt stamped for any non-draft status.
 *
 * Now: Issue needs a recipient (a client or a bill-to name); an amount over
 * $250,000 asks for a second press; nothing over the $1bn cap is accepted;
 * and an invoice with nobody to send it to is a draft with a "not sent —
 * share the link" notice, never "sent" (REQ-480 amended).
 */
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const invoiceForm = () => require("../../shared/documents/invoice-form");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const assistantDraft = () => require("../../shared/quote-flow/assistant-draft");

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const tOf =
  (dict: Record<string, string>) =>
  (key: string, params: Record<string, string> = {}) => {
    const tpl = dict[key];
    if (typeof tpl !== "string") throw new Error(`missing lang key ${key}`);
    return tpl.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`);
  };

const DEMO_CENTS = 99_999_999_00; // the demo's $99,999,999

describe("REQ-550 B1 (cycle 4): an invoice is never issued to nobody, never 'sent' with nothing sent, and a huge amount is confirmed", () => {
  it("REQ-550 newInvoiceStatus: Issue with no contact to dispatch to is a draft, never sent (REQ-480 amended)", () => {
    const { newInvoiceStatus } = invoiceForm();
    expect(newInvoiceStatus({ issue: true, dispatch: false })).toBe("draft");
    expect(newInvoiceStatus({ issue: true, dispatch: true })).toBe("draft");
    expect(
      newInvoiceStatus({
        issue: false,
        dispatch: false,
        scheduledFor: "2099-01-01",
      }),
    ).toBe("scheduled");
  });

  it("REQ-550 invoiceIssueBlock: Issue needs a client or a bill-to name; a draft does not", () => {
    const { invoiceIssueBlock } = invoiceForm();
    // the demo: no client, no bill-to, $99,999,999
    expect(invoiceIssueBlock({ issue: true, totalCents: DEMO_CENTS })).toBe(
      "errRecipient",
    );
    expect(
      invoiceIssueBlock({ issue: true, totalCents: 500_00, billToName: "   " }),
    ).toBe("errRecipient");
    expect(
      invoiceIssueBlock({
        issue: true,
        totalCents: 500_00,
        billToName: "Ana Ruiz",
      }),
    ).toBeNull();
    expect(
      invoiceIssueBlock({ issue: true, totalCents: 500_00, customerId: "c-1" }),
    ).toBeNull();
    expect(
      invoiceIssueBlock({
        issue: true,
        totalCents: 500_00,
        newClientName: "Bo",
      }),
    ).toBeNull();
    expect(invoiceIssueBlock({ issue: false, totalCents: 500_00 })).toBeNull();
  });

  it("REQ-550 invoiceIssueBlock: nothing past the $1bn cap (assistant-draft's MAX_CENTS), on Issue or draft", () => {
    const { invoiceIssueBlock, INVOICE_MAX_CENTS } = invoiceForm();
    expect(INVOICE_MAX_CENTS).toBe(assistantDraft().MAX_CENTS);
    expect(INVOICE_MAX_CENTS).toBe(100_000_000_000);
    expect(
      invoiceIssueBlock({
        issue: true,
        totalCents: INVOICE_MAX_CENTS + 1,
        customerId: "c-1",
      }),
    ).toBe("errAmountMax");
    expect(
      invoiceIssueBlock({ issue: false, totalCents: INVOICE_MAX_CENTS + 1 }),
    ).toBe("errAmountMax");
    expect(
      invoiceIssueBlock({
        issue: true,
        totalCents: INVOICE_MAX_CENTS,
        customerId: "c-1",
      }),
    ).toBeNull();
  });

  it("REQ-550 needsAmountConfirm: over $250,000 asks again, until that exact total is confirmed", () => {
    const { needsAmountConfirm, INVOICE_CONFIRM_CENTS } = invoiceForm();
    expect(INVOICE_CONFIRM_CENTS).toBe(250_000_00);
    expect(needsAmountConfirm(DEMO_CENTS)).toBe(true);
    expect(needsAmountConfirm(250_000_00)).toBe(false);
    expect(needsAmountConfirm(250_000_01)).toBe(true);
    expect(needsAmountConfirm(DEMO_CENTS, DEMO_CENTS)).toBe(false);
    // the amount changed after the confirm → ask again
    expect(needsAmountConfirm(DEMO_CENTS, 99_999_998_00)).toBe(true);
  });

  it("REQ-550 the 'not sent — share the link' notice, en and es", () => {
    const { invoiceNotSentCopy } = invoiceForm();
    const link = "https://documonster.com/i/inv-1";
    const enText = invoiceNotSentCopy(tOf(en), { number: "INV-003", link });
    expect(enText).toContain("INV-003");
    expect(enText).toMatch(/not sent/i);
    expect(enText).toContain(link);
    expect(enText).not.toMatch(/was sent/i);
    const esText = invoiceNotSentCopy(tOf(es), { number: "INV-003", link });
    expect(esText).toContain("INV-003");
    expect(esText).toMatch(/no se envió/i);
    expect(esText).toContain(link);
    // fallback when the number is missing
    expect(invoiceNotSentCopy(tOf(en), { link })).toContain("Invoice");
    expect(invoiceNotSentCopy(tOf(es), { link })).toContain("Factura");
  });

  it("REQ-550 en/es keys exist with the same placeholders", () => {
    const keys = [
      "invoicesPage.new.errRecipient",
      "invoicesPage.new.errAmountMax",
      "invoicesPage.new.confirmLarge",
      "invoicesPage.send.notSentShareLink",
    ];
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const k of keys) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(ph(es[k])).toBe(ph(en[k]));
    }
    expect(en["invoicesPage.new.confirmLarge"]).toContain("{amount}");
    expect(en["invoicesPage.send.notSentShareLink"]).toContain("{link}");
  });

  it("REQ-550 the island wires it: submit blocks via invoiceIssueBlock, confirms via needsAmountConfirm, and flashes the not-sent notice", () => {
    const src = read("front-end/islands/InvoicesPage.tsx");
    const submit = src.slice(
      src.indexOf("async function submit(issue: boolean)"),
      src.indexOf("function onFormSubmit"),
    );
    expect(submit).toContain("invoiceIssueBlock(");
    expect(submit).toContain("needsAmountConfirm(");
    expect(submit).toContain("invoiceNotSentCopy(");
    expect(src).toContain('data-cy="new-invoice-confirm-large"');
    expect(src).toContain('"invoice-not-sent"');
  });
});
