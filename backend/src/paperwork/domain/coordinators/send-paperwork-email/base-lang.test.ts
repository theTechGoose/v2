/**
 * REQ-710 (demo-loop cycle 5, M4): "the English version of a Spanish-typed
 * invoice keeps the Spanish title". Pair 9 issued a standalone invoice
 * ("Nueva factura", no quote) typed in Spanish; TranslateInvoice stored its
 * English title and concepts (REQ-497), /i read them, but the e-mail drew
 * `jobName` / `description` exactly as typed and the payment instructions
 * frozen in the owner's language ("Zelle: … · Efectivo"). The e-mail now
 * reads the same per-language copies /i reads, while they still describe the
 * invoice's text.
 */
import { assertMatch, assertNotMatch, assertStringIncludes } from "#std/assert";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import type { User } from "@users/dto/user.ts";
import type { BusinessIdentity } from "@users/dto/business-identity.ts";
import { renderInvoiceHtml } from "./mod.ts";

const rosa = {
  id: "u-rosa",
  name: "Rosa Díaz",
  phoneNumber: "+15125550108",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as User;

/** The customer reads English. */
const englishBiz = {
  userId: "u-rosa",
  businessName: "Díaz Hauling",
  commsLanguage: "en",
} as BusinessIdentity;

/** Pair 9's INV-002 as TranslateInvoice left it. */
const inv002 = {
  id: "i-2",
  userId: "u-rosa",
  number: "INV-002",
  status: "sent",
  amount: 20_000,
  billTo: { name: "Jorge Ruiz" },
  jobName: "Retiro de electrodomésticos",
  description: "Retiro de refrigerador y lavadora",
  paymentInstructions: "Zelle: +1 (512) 555-0108 · Efectivo",
  lang: "es",
  jobNameByLang: { es: "Retiro de electrodomésticos", en: "Appliance Removal" },
  descriptionByLang: {
    es: "Retiro de refrigerador y lavadora",
    en: "Removal of refrigerator and washing machine",
  },
  dueDate: "2026-12-30",
  createdAt: "2026-11-12T12:00:00Z",
  updatedAt: "2026-11-12T12:00:00Z",
} as unknown as Invoice;

Deno.test("REQ-710 (cycle 5, M4) the English e-mail of a standalone invoice typed in Spanish shows its English title, concepts and payment methods (pair 9)", () => {
  const html = renderInvoiceHtml(inv002, undefined, rosa, englishBiz);
  assertStringIncludes(html, "Appliance Removal");
  assertStringIncludes(html, "Removal of refrigerator and washing machine");
  assertNotMatch(html, /Retiro de/);
  assertMatch(html, /Zelle: \+1 \(512\) 555-0108 · Cash/);
  assertNotMatch(html, /Efectivo/);
});

Deno.test("REQ-710 (cycle 5, M4) the Spanish e-mail of the same invoice keeps the typed Spanish", () => {
  const html = renderInvoiceHtml(inv002, undefined, rosa, {
    ...englishBiz,
    commsLanguage: "es",
  } as BusinessIdentity);
  assertStringIncludes(html, "Retiro de electrodomésticos");
  assertStringIncludes(html, "Retiro de refrigerador y lavadora");
  assertMatch(html, /· Efectivo/);
});

Deno.test("REQ-710 (cycle 5, M4) a title edited after the translation shows as typed — an older translation never stands in for it", () => {
  const html = renderInvoiceHtml(
    { ...inv002, jobName: "Retiro de estufa" } as Invoice,
    undefined,
    rosa,
    englishBiz,
  );
  assertStringIncludes(html, "Retiro de estufa");
  assertNotMatch(html, /Appliance Removal/);
});
