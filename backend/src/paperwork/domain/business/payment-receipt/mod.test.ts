/**
 * REQ-1071 (LOOP-007 cycle 2, issue q2-60): the part-payment receipt tells
 * the customer what is still due and links them to pay it.
 *
 * QA paid $500 of a $1,190.75 invoice; the receipt email read "Registramos tu
 * pago de <strong>$500</strong>. Adjuntamos un recibo…" — no cents, no
 * remaining balance, no link back to the invoice. The SMS receipt of the same
 * payment carries a /s link; every invoice email prints money with cents.
 *
 * renderReceiptHtml takes the invoice total, the balance left and the pay
 * URL: with a balance it prints "$690.75" (and the total) and a button to
 * the pay URL; with nothing left it prints neither.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import type { Lang } from "@core/i18n/mod.ts";
import { fmtUSD, renderReceiptHtml } from "./mod.ts";

const PAY_URL = "https://documonster.com/s/abc123?lang=es";

type ReceiptOpts = Parameters<typeof renderReceiptHtml>[0];

/** the receipt for $500 of a $1,190.75 invoice — $690.75 left */
function partReceipt(lang: Lang, balanceCents = 69075): string {
  const opts = {
    invoice: {
      id: "inv-1",
      number: "INV-001",
      status: "sent",
      billTo: { name: "Pat Doe" },
    },
    businessName: "Ortega Painting",
    intent: { method: "check" as const },
    amount: 50000,
    lang,
    // the fields q2-60 adds — passed through a variable so this file
    // compiles before they exist on the opts type
    totalCents: 119075,
    balanceCents,
    payUrl: PAY_URL,
  };
  return renderReceiptHtml(opts as ReceiptOpts);
}

Deno.test("REQ-1071 q2-60: fmtUSD prints cents like every invoice email — 50000 → $500.00", () => {
  assertEquals(fmtUSD(50000), "$500.00");
  assertEquals(fmtUSD(119075), "$1,190.75");
});

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-1071 q2-60 (${lang}): a part-payment receipt prints the amount with cents`, () => {
    assertStringIncludes(partReceipt(lang), "$500.00");
  });

  Deno.test(`REQ-1071 q2-60 (${lang}): a part-payment receipt shows the balance still due ($690.75 of $1,190.75)`, () => {
    const html = partReceipt(lang);
    assertStringIncludes(html, "$690.75", "the remaining balance");
    assertStringIncludes(html, "$1,190.75", "the invoice total");
  });

  Deno.test(`REQ-1071 q2-60 (${lang}): a part-payment receipt links the customer to pay the balance`, () => {
    const html = partReceipt(lang);
    assert(
      html.includes(`href="${PAY_URL.replace(/&/g, "&amp;")}"`) ||
        html.includes(`href="${PAY_URL}"`),
      `a link to the pay URL ${PAY_URL}; got:\n${html}`,
    );
  });

  Deno.test(`REQ-1071 q2-60 (${lang}): nothing left to pay → no balance line and no pay link`, () => {
    const html = partReceipt(lang, 0);
    assert(!html.includes("$690.75"), "no balance figure");
    assert(!html.includes(PAY_URL), "no pay link");
  });
}
