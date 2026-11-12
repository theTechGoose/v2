/**
 * REQ-593 — demo-loop cycle 4, issue m12: "Phone numbers shown raw /
 * unformatted". formatPhoneDisplay / formatPhoneInput
 * (shared/quote-flow/format-helpers.ts) exist, but several screens printed
 * the stored digits or the E.164 as is:
 *   - New invoice BILL TO phone: billToFromCustomer copied "5125550199"
 *     verbatim and the tel input bound `value={billTo.phoneNumber}`;
 *   - the send dialog's text preview heading printed `preview.sms.to` raw;
 *   - payment instructions prefilled from onboarding read "Zelle: 5125550109";
 *   - the /worker sign-in cell input had no mask;
 *   - the open quote's "Texted to" receipt printed the E.164.
 * (The backend "…texted to +15128675309" divider is pinned in
 * backend/src/agents/domain/coordinators/send-quote/divider.test.ts.)
 */
import * as fs from "fs";
import * as path from "path";
import {
  billToFromCustomer,
  paymentInstructionsFromMethods,
} from "../../shared/documents/invoice-form";
import { sendPreviewSmsTo } from "../../shared/quote-flow/send-preview";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-593 (demo cycle 4, m12) phone numbers are formatted wherever they are shown", () => {
  test("REQ-593 BILL TO: a customer's stored '5125550199' fills the field as '(512) 555-0199'", () => {
    expect(billToFromCustomer({ phoneNumber: "5125550199" }).phoneNumber)
      .toBe("(512) 555-0199");
    expect(billToFromCustomer({ phoneNumber: "+15125550199" }).phoneNumber)
      .toBe("(512) 555-0199");
    // a number that is not a US ten-digit one is kept, never truncated
    expect(billToFromCustomer({ phoneNumber: "+44 20 7946 0958" }).phoneNumber)
      .toBe("+44 20 7946 0958");
    expect(billToFromCustomer({}).phoneNumber).toBe("");
  });

  test("REQ-593 BILL TO: the tel input is masked as the contractor types", () => {
    const src = read("front-end/islands/InvoicesPage.tsx");
    const at = src.indexOf('data-cy="new-invoice-bill-phone"');
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 200)).toContain(
      "value={formatPhoneInput(billTo.phoneNumber)}",
    );
  });

  test("REQ-593 payment instructions from onboarding: 'Zelle: 5125550109' reads 'Zelle: +1 (512) 555-0109'", () => {
    const methods = {
      zelle: { enabled: true, handle: "5125550109" },
      venmo: { enabled: true, handle: "@bob-roofs" },
      paypal: { enabled: true, handle: "bob@example.com" },
      cash: { enabled: true },
    };
    expect(paymentInstructionsFromMethods(methods, "en")).toBe(
      "Venmo: @bob-roofs · Zelle: +1 (512) 555-0109 · PayPal: bob@example.com · Cash",
    );
    expect(
      paymentInstructionsFromMethods(
        { zelle: { enabled: true, handle: "(512) 555-0109" } },
        "es",
      ),
    ).toBe("Zelle: +1 (512) 555-0109");
  });

  test("REQ-593 send dialog: the text preview names the number as '+1 (512) 867-5309', not the E.164", () => {
    expect(
      sendPreviewSmsTo({ lang: "es", sms: { to: "+15128675309", body: "x" } }),
    ).toBe("+1 (512) 867-5309");
    expect(sendPreviewSmsTo({ lang: "en", sms: { body: "x" } })).toBe("");
    expect(sendPreviewSmsTo({ lang: "en" })).toBe("");
    const src = read("front-end/components/SendLangPreview.tsx");
    expect(src).toContain("sendPreviewSmsTo(preview)");
    expect(src).not.toContain("${preview.sms.to}");
  });

  test("REQ-593 /worker sign-in: the cell input is masked", () => {
    const src = read("front-end/islands/WorkerScreen.tsx");
    const at = src.indexOf('data-cy="w-cell"');
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 400)).toContain("value={formatPhoneInput(cell)}");
  });

  test("REQ-593 open quote receipts: 'Texted to' shows the formatted number", () => {
    const src = read("front-end/islands/QuotesPage.tsx");
    const at = src.indexOf('"quotesPage.open.receipt.textedTo"');
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 200)).toContain("formatPhoneDisplay(r.to)");
  });
});
