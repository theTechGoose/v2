/**
 * REQ-409 — demo-loop cycle 2, issue m39: "New invoice modal says 'without a
 * quote' for a quote-derived invoice and 'Acordado' for an unsent draft".
 *
 * Opened from a quote (/invoices?new=1&quoteId=), the New invoice modal
 * always rendered invoicesPage.new.intro ("Cobra a un cliente directamente,
 * sin cotización…") and the ledger strip always read "Acordado {agreed}",
 * even for a quote the customer never accepted. The copy is now picked by
 * newInvoiceCopy() in shared/documents/invoice-form.ts: a quote intro when
 * the form drew on a quote, and "Agreed" only once it was accepted — the
 * same rule as the ledger panel's "agreed"/"quoted" row (REQ-249).
 */
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod = () => require("../../shared/documents/invoice-form");

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const fill = (tpl: string, vars: Record<string, string>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k]);

const ledgerOf = (accepted: boolean) => ({
  quote: { id: "q1", number: "Q-0007", accepted },
  agreementTotalCents: 2800000,
  invoicedCents: 0,
  remainingToInvoiceCents: 2800000,
});

const VARS = {
  number: "Q-0007",
  agreed: "$28,000.00",
  quoted: "$28,000.00",
  invoiced: "$0.00",
  remaining: "$28,000.00",
};

describe("REQ-409 m39 New invoice copy from a quote", () => {
  it("REQ-409 prefillFromLedger carries the quote's accepted state", () => {
    const { prefillFromLedger } = mod();
    expect(prefillFromLedger(ledgerOf(true), null).quoteAccepted).toBe(true);
    expect(prefillFromLedger(ledgerOf(false), null).quoteAccepted).toBe(false);
  });

  it("REQ-409 without a quote the modal keeps the direct-bill intro and no ledger line", () => {
    const { newInvoiceCopy } = mod();
    expect(newInvoiceCopy(null)).toEqual({
      introKey: "invoicesPage.new.intro",
      ledgerKey: null,
      notAcceptedKey: null,
    });
  });

  it("REQ-409 an unaccepted quote reads 'Quoted', never 'Agreed', never 'no quote needed', and warns", () => {
    const { prefillFromLedger, newInvoiceCopy } = mod();
    const c = newInvoiceCopy(prefillFromLedger(ledgerOf(false), null));
    expect(c.introKey).toBe("invoicesPage.new.introFromQuote");
    expect(c.ledgerKey).toBe("invoices.form.originalQuoteQuoted");
    expect(c.notAcceptedKey).toBe("invoices.form.quoteNotAccepted");
    const esIntro = fill(es[c.introKey], VARS);
    const esLedger = fill(es[c.ledgerKey], VARS);
    expect(esIntro).toContain("Q-0007");
    expect(esIntro).not.toMatch(/sin cotización/);
    expect(esLedger).toContain("Cotizado $28,000.00");
    expect(esLedger).not.toMatch(/Acordado/);
    expect(fill(en[c.introKey], VARS)).not.toMatch(/no quote/i);
    expect(fill(en[c.ledgerKey], VARS)).toContain("Quoted $28,000.00");
    expect(fill(en[c.ledgerKey], VARS)).not.toMatch(/Agreed/);
    expect(en[c.notAcceptedKey]).toBeTruthy();
    expect(es[c.notAcceptedKey]).toBeTruthy();
  });

  it("REQ-409 an accepted quote reads 'Agreed' with the quote intro and no warning", () => {
    const { prefillFromLedger, newInvoiceCopy } = mod();
    const c = newInvoiceCopy(prefillFromLedger(ledgerOf(true), null));
    expect(c.introKey).toBe("invoicesPage.new.introFromQuote");
    expect(c.ledgerKey).toBe("invoices.form.originalQuote");
    expect(c.notAcceptedKey).toBeNull();
    expect(fill(es[c.ledgerKey], VARS)).toContain("Acordado $28,000.00");
    expect(fill(en[c.ledgerKey], VARS)).toContain("Agreed $28,000.00");
  });

  it("REQ-409 en and es carry the same new keys with the same placeholders", () => {
    for (
      const k of [
        "invoicesPage.new.introFromQuote",
        "invoices.form.originalQuoteQuoted",
        "invoices.form.quoteNotAccepted",
      ]
    ) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(ph(es[k])).toEqual(ph(en[k]));
    }
  });

  it("REQ-409 the NewInvoice modal renders its copy from newInvoiceCopy, not a fixed intro", () => {
    const src = read("front-end/islands/InvoicesPage.tsx");
    expect(src).toMatch(/newInvoiceCopy\(ledger\)/);
    expect(src).not.toMatch(/tFor\(lang, "invoicesPage\.new\.intro"\)/);
    expect(src).not.toMatch(/tFor\(lang, "invoices\.form\.originalQuote",/);
  });
});
