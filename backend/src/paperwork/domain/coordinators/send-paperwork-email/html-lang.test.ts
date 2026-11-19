/**
 * REQ-1016 (LOOP-007 cycle 1, q1-102): "Spanish Paid email is marked
 * <html lang="en">". Every customer email's `<html lang>` is the language it
 * is written in. The amount-only invoice email (and the paid one) is built by
 * the generic `shell()` wrapper, which wrote a fixed `<html lang="en">` while
 * its words and `<title>` followed `lang`; the quote and itemized-invoice
 * templates already write `<html lang="${L.docLang}">`.
 */
import { assertEquals, assertStringIncludes } from "#std/assert";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import type { User } from "@users/dto/user.ts";
import type { BusinessIdentity } from "@users/dto/business-identity.ts";
import { renderInvoiceBasicHtml, renderInvoiceHtml } from "./mod.ts";

const owner = {
  id: "u-luis",
  name: "Luis Ortega",
  phoneNumber: "+15125550108",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as User;

const biz = (commsLanguage: "en" | "es") =>
  ({
    userId: "u-luis",
    businessName: "Ortega Handyman Services",
    commsLanguage,
  }) as BusinessIdentity;

/** QA5's INV-001: an amount-only invoice, no quote behind it. */
const inv001 = {
  id: "i-1",
  userId: "u-luis",
  number: "INV-001",
  status: "paid",
  amount: 45_000,
  billTo: { name: "María López", email: "maria@example.com" },
  jobName: "Reparación de cerca",
  dueDate: "2026-12-30",
  paidAt: "2026-11-18T15:00:00Z",
  createdAt: "2026-11-12T12:00:00Z",
  updatedAt: "2026-11-12T12:00:00Z",
} as unknown as Invoice;

/** The root element's lang, read off the document's first two lines. */
const rootLang = (html: string) =>
  html.match(/^<!doctype html>\s*<html lang="([^"]*)">/i)?.[1] ?? "(no <html lang>)";

for (const paid of [true, false]) {
  Deno.test(`REQ-1016 (LOOP-007 q1, q1-102) renderInvoiceBasicHtml in Spanish (paid=${paid}) declares <html lang="es"> and a Spanish <title>`, () => {
    const html = renderInvoiceBasicHtml(
      inv001,
      undefined,
      owner,
      biz("es"),
      "es",
      paid,
    );
    assertStringIncludes(html, "<title>Factura");
    assertEquals(rootLang(html), "es", "the Spanish email's <html lang>");
  });
}

Deno.test('REQ-1016 (LOOP-007 q1, q1-102) renderInvoiceHtml for a quote-less invoice follows the business\'s comms language: es → <html lang="es">, en → <html lang="en">', () => {
  const es = renderInvoiceHtml(inv001, undefined, owner, biz("es"), undefined, true);
  assertStringIncludes(es, "<title>Factura");
  assertEquals(rootLang(es), "es", "es business → <html lang=\"es\">");
  const en = renderInvoiceHtml(inv001, undefined, owner, biz("en"), undefined, true);
  assertStringIncludes(en, "<title>Invoice");
  assertEquals(rootLang(en), "en", "en business → <html lang=\"en\">");
});
