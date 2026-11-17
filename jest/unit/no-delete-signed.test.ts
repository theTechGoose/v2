/**
 * REQ-485 (demo-loop cycle 3, issue m22) — Delete is not offered on a signed
 * quote or on a paid invoice. Before: DecidedRow rendered
 * `<DeleteQuoteButton … />` on every decided row, won included, and the
 * invoice detail rendered "Delete invoice" disabled (greyed, still visible)
 * on a paid invoice.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-485 (m22) no Delete on a signed quote or a paid invoice", () => {
  const sections = read("front-end/components/QuotesSections.tsx");
  const card = read("front-end/islands/QuoteCard.tsx");
  const invoices = read("front-end/islands/InvoicesPage.tsx");

  test("REQ-485 DecidedRow renders DeleteQuoteButton only when the quote is not won", () => {
    const row = sections.slice(sections.indexOf("export function DecidedRow"));
    const at = row.indexOf("<DeleteQuoteButton");
    expect(at).toBeGreaterThan(-1);
    const before = row.slice(Math.max(0, at - 80), at);
    expect(before).toMatch(/q\.stage !== "won" &&/);
  });

  test("REQ-485 QuoteCard renders DeleteQuoteButton only when the quote is not won", () => {
    const at = card.indexOf("<DeleteQuoteButton");
    const before = card.slice(Math.max(0, at - 80), at);
    expect(before).toMatch(/q\.stage !== "won" &&/);
  });

  for (
    const [cy, guard] of [
      ["invoice-delete", /: !locked && \(\s*<button\s*$/],
      ["invoice-card-delete", /: !isInvoiceLocked\(inv\) && \(\s*<button\s*$/],
    ] as const
  ) {
    test(`REQ-485 a paid (locked) invoice hides ${cy} instead of disabling it`, () => {
      const at = invoices.indexOf(`data-cy="${cy}"`);
      expect(at).toBeGreaterThan(-1);
      const open = invoices.lastIndexOf("<button", at);
      const btn = invoices.slice(open, invoices.indexOf("</button>", at));
      expect(btn).not.toMatch(/disabled=/);
      expect(btn).not.toMatch(/lockedPaid/);
      // the button is only rendered when the invoice is not locked
      expect(invoices.slice(open - 120, open + "<button".length)).toMatch(guard);
    });
  }
});
