/**
 * REQ-1139 — LOOP-007 cycle 3, issue q3-70 [minor/BUG_CONTRADICTION]: "/i
 * header says 'Enviada/Sent' while the pill says 'PAGO PARCIAL/PARTLY PAID'".
 *
 * QA issued INV-001 for $1,190.75 and recorded $500 (stored status
 * "pending"). The pill / stage chip follow REQ-1073's isPartlyPaid and read
 * "Pago parcial"; the REQ-201 headline line (number · version · state) still
 * follows invoiceState() and reads "INV-001 · Versión 1 · Enviada" on /i and
 * "INV-001 · Version 1 · Sent" on /invoices. One card, two statuses.
 *
 * The /invoices card and detail render formatInvoiceHeadline(inv,
 * headlineLabels(lang), versionWord) (front-end/islands/InvoicesPage.tsx
 * headlineOf). This test calls it the same way, with the labels read from
 * lang/*.json. The headline must agree with the pill: say "Partly paid" /
 * "Pago parcial", or carry no state word at all — never "Sent" / "Enviada".
 */
import * as fs from "fs";
import * as path from "path";
import { formatInvoiceHeadline } from "../../shared/documents/invoice-form";
import {
  invoicePillFlags,
  isPartlyPaid,
} from "../../shared/documents/invoice-status";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const dict = {
  en: JSON.parse(read("lang/en.json")) as Record<string, string>,
  es: JSON.parse(read("lang/es.json")) as Record<string, string>,
};

const now = new Date();
const day = (offset: number) =>
  new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);

/** INV-001, $1,190.75, $500 paid, due in two weeks — as the store holds it */
const partPaid = {
  id: "i1",
  number: "INV-001",
  version: 1,
  customerId: "c1",
  amount: 119075,
  paidCents: 50000,
  status: "pending",
  issuedDate: day(-1),
  dueDate: day(14),
};

/** InvoicesPage headlineLabels(lang): every invoices.state.* key it may use */
function headlineLabels(lang: "en" | "es"): Record<string, string> {
  const d = dict[lang];
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(d)) {
    const m = /^invoices\.state\.(.+)$/.exec(k);
    if (m) out[m[1]] = v;
  }
  return out;
}

const headline = (lang: "en" | "es") =>
  formatInvoiceHeadline(
    partPaid,
    headlineLabels(lang),
    dict[lang]["invoices.versionWord"],
  );

describe("REQ-1139 (LOOP-007 q3-70) a part-paid invoice's headline agrees with its 'Partly paid' pill", () => {
  test("REQ-1139 baseline: the pill rule (REQ-1073) calls this invoice partly paid", () => {
    expect(isPartlyPaid(partPaid)).toBe(true);
    expect(invoicePillFlags(partPaid, now).partlyPaid).toBe(true);
  });

  test("REQ-1139 /invoices headline (en) does not say 'Sent' next to the 'Partly paid' pill", () => {
    const h = headline("en");
    expect(h).toMatch(/^INV-001 · Version 1/);
    expect(h).not.toMatch(/\bSent\b/);
    // either the pill's word, or no state word at all
    expect(h === "INV-001 · Version 1" || /Partly paid/.test(h)).toBe(true);
  });

  test("REQ-1139 /invoices headline (es) does not say 'Enviada' next to the 'Pago parcial' pill", () => {
    const h = headline("es");
    expect(h).toMatch(/^INV-001 · Versión 1/);
    expect(h).not.toMatch(/Enviada/);
    expect(h === "INV-001 · Versión 1" || /Pago parcial/.test(h)).toBe(true);
  });
});
