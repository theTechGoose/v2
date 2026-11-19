/**
 * REQ-1028 — LOOP-007 cycle 2, issues q2-9 + q2-20.
 *
 * The invoice email's "Estado" row is `invoiceStatusLabel(i.status, lang)`
 * (shared/quote-flow/email-format.ts). Its table copies the QUOTE "status.*"
 * family — masculine ("Enviado", "Pagado", "Visto"), while a factura is
 * feminine and the /i page reads "Enviada" (public.doc.state.sent /
 * invoices.state.sent). It also has no entry for "pending" — the status
 * ComputeInvoiceBalance stores after a part payment — so a Spanish email
 * prints the raw English enum "Pending".
 */
import { invoiceStatusLabel } from "../../shared/quote-flow/email-format";

const enDict: Record<string, string> = require("../../lang/en.json");
const esDict: Record<string, string> = require("../../lang/es.json");

describe("REQ-1028 invoiceStatusLabel — the invoice (feminine) word, never a raw enum", () => {
  it("REQ-1028 (q2-20): es 'sent' is the /i page's word 'Enviada', not the quote's 'Enviado'", () => {
    expect(invoiceStatusLabel("sent", "es")).toBe(esDict["public.doc.state.sent"]);
    expect(invoiceStatusLabel("sent", "es")).toBe(esDict["invoices.state.sent"]);
  });

  it("REQ-1028 (q2-20): es paid / viewed / void use the invoice family (Pagada, Vista, Anulada)", () => {
    expect(invoiceStatusLabel("paid", "es")).toBe(esDict["invoices.state.paid"]);
    expect(invoiceStatusLabel("viewed", "es")).toBe(esDict["invoices.state.viewed"]);
    expect(invoiceStatusLabel("void", "es")).toBe(esDict["invoices.state.void"]);
  });

  it("REQ-1028 (q2-9): es 'pending' (a part-paid invoice) is Spanish, never 'Pending'", () => {
    const label = invoiceStatusLabel("pending", "es");
    expect(label).not.toBe("Pending");
    expect(label.toLowerCase()).not.toBe("pending");
    // whatever the fix picks, it is not the English label for the same status
    expect(label).not.toBe(invoiceStatusLabel("pending", "en"));
  });

  it("REQ-1028 (q2-9): no invoice status comes back in es as its own raw enum", () => {
    for (const s of ["sent", "viewed", "paid", "pending", "partial", "claimed", "void", "scheduled"]) {
      const label = invoiceStatusLabel(s, "es");
      expect({ s, label: label.toLowerCase() }).not.toEqual({ s, label: s });
    }
  });

  it("REQ-1028: en keeps the invoice family's English words", () => {
    expect(invoiceStatusLabel("sent", "en")).toBe(enDict["invoices.state.sent"]);
  });
});
