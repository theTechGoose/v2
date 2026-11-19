/**
 * REQ-1032 (LOOP-007 q2, q2-15) — a phone-shaped pay handle reads as a phone in the invoice
 * email's "Ways to pay" block, "(512) 555-0700", the same as the Payment-instructions line above
 * it (REQ-326 / REQ-593 / REQ-965) — never the raw digits as typed at onboarding. Email, @name
 * and $cashtag handles stay exactly as typed.
 */
import { assert, assertStringIncludes } from "#std/assert";
import { payWaysEmailHtml } from "./mod.ts";

/** The visible text of an email fragment: tags dropped, entities the block escapes decoded. */
function visible(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
}

Deno.test("REQ-1032 (q2-15) payWaysEmailHtml: a phone Zelle handle typed as '5125550700' reads 'envía a (512) 555-0700', never the raw digits", () => {
  const html = payWaysEmailHtml(
    { zelle: { enabled: true, handle: "5125550700" } },
    { card: false, lang: "es", payUrl: "https://x.test/i/1" },
  );
  const text = visible(html);
  assertStringIncludes(text, "Zelle: envía a (512) 555-0700");
  assert(
    !text.includes("5125550700"),
    `the Ways-to-pay block prints the raw digits: ${text}`,
  );
});

Deno.test("REQ-1032 (q2-15) payWaysEmailHtml: '+1 512 555 0700' reads '(512) 555-0700' in English too", () => {
  const text = visible(payWaysEmailHtml(
    { zelle: { enabled: true, handle: "+1 512 555 0700" } },
    { card: false, lang: "en", payUrl: "https://x.test/i/1" },
  ));
  assertStringIncludes(text, "Zelle: send to (512) 555-0700");
});

Deno.test("REQ-1032 (q2-15) payWaysEmailHtml: an email Zelle handle stays exactly as typed", () => {
  const text = visible(payWaysEmailHtml(
    { zelle: { enabled: true, handle: "pay@acme.test" } },
    { card: false, lang: "en", payUrl: "https://x.test/i/1" },
  ));
  assertStringIncludes(text, "Zelle: send to pay@acme.test");
});
