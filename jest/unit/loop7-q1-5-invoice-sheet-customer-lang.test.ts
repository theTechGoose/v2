/**
 * REQ-934 (LOOP-007 cycle 1, issue q1-5; amends REQ-715 / REQ-727) —
 * "Customer set to Español is invoiced in English from her own page".
 *
 * The invoice send sheet's "Sends in" started on the invoice's typed
 * language only (invoiceSheetLang), so an amount-only invoice (no lang) fell
 * through to the server's preview answer, and an invoice typed in English for
 * a Spanish-speaking customer started on English. invoiceDocLang ranks the
 * customer's language first (REQ-715); the sheet must agree: the customer's
 * language, else the invoice's typed language, else ask the server.
 *
 * Pure rule: front-end/lib/invoice-send-sheet.ts invoiceSheetLang(invoice,
 * customer). Wiring: components/InvoiceSendDialog.tsx passes the customer.
 */
import * as fs from "fs";
import * as path from "path";
import { invoiceSheetLang } from "../../front-end/lib/invoice-send-sheet.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// the fix adds the customer as a second argument; call through a loose type
// so this file compiles against today's one-argument signature too
const sheetLang = invoiceSheetLang as unknown as (
  inv: { lang?: string | null },
  customer?: { language?: string | null } | null,
) => "en" | "es" | undefined;

describe("REQ-934 q1-5 the invoice send sheet starts on the customer's language", () => {
  it("REQ-934 q1-5 an amount-only invoice (no lang) for a Spanish-speaking customer starts on Español", () => {
    expect(sheetLang({}, { language: "es" })).toBe("es");
  });

  it("REQ-934 q1-5 the customer's language outranks the invoice's typed language (invoiceDocLang's order)", () => {
    expect(sheetLang({ lang: "en" }, { language: "es" })).toBe("es");
    expect(sheetLang({ lang: "es" }, { language: "en" })).toBe("en");
  });

  it("REQ-934 q1-5 no customer language → the invoice's typed language, else undefined (the server decides)", () => {
    expect(sheetLang({ lang: "es" }, { language: undefined })).toBe("es");
    expect(sheetLang({ lang: "en" }, null)).toBe("en");
    expect(sheetLang({}, {})).toBeUndefined();
    expect(sheetLang({}, { language: "fr" })).toBeUndefined();
  });

  it("REQ-934 q1-5 InvoiceSendDialog hands the customer to invoiceSheetLang", () => {
    const dlg = read("front-end/components/InvoiceSendDialog.tsx");
    expect(dlg).toMatch(
      /initialSendLang=\{invoiceSheetLang\(\s*invoice\s*,\s*customer\s*\)\}/,
    );
  });
});
