/**
 * REQ-463 — demo-loop cycle 3, issue m31: the quote PDF's clause 7 read
 * "El contratista garantiza su mano de obra por el período indicado en este
 * acuerdo" on a lawn-care agreement whose terms carry no warranty at all
 * (the REQ-343 service wizard has no warranty step). The PDF now states the
 * warranty from the terms: the period when one is set, a no-warranty body
 * otherwise.
 */
import { assert, assertStringIncludes } from "#std/assert";
import { decodePDFRawStream, PDFDocument, PDFRawStream } from "#pdf-lib";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { User } from "@users/dto/user.ts";
import { RenderQuotePdf } from "./mod.ts";

/** Every string pdf-lib drew (hex-string / literal Tj operators). */
async function drawnText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  let out = "";
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    let s: string;
    try {
      s = new TextDecoder("latin1").decode(decodePDFRawStream(obj).decode());
    } catch {
      continue;
    }
    for (const m of s.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      let line = "";
      for (let i = 0; i + 1 < m[1].length; i += 2) {
        line += String.fromCharCode(parseInt(m[1].slice(i, i + 2), 16));
      }
      out += line + "\n";
    }
    for (const m of s.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) {
      out += m[1] + "\n";
    }
  }
  // the clause wraps across lines; join them so phrases match whole
  return out.replace(/\s*\n\s*/g, " ");
}

const contractor = {
  id: "u-1",
  name: "Pedro",
  phoneNumber: "+15125550000",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as User;

const SERVICE_TERMS = [
  { stepId: "start_date", label: "Start date", value: "Right away" },
  { stepId: "wraps", label: "Time to complete", value: "2 hours" },
  {
    stepId: "payment_terms",
    label: "Payment terms",
    value: "Payment upon completion",
  },
];

function quote(terms: Quote["terms"]): Quote {
  return {
    id: "4567efab-0000-4000-8000-000000000031",
    userId: "u-1",
    number: "Q-031",
    version: 1,
    status: "sent",
    summary: "Corte de césped y limpieza",
    lineItems: [{ description: "Corte", quantity: 1, price: 120_00 }],
    estimatedTotal: 120_00,
    terms,
    createdAt: "2026-11-12T12:00:00Z",
    updatedAt: "2026-11-12T12:00:00Z",
  } as unknown as Quote;
}

const render = async (terms: Quote["terms"], lang: "en" | "es") =>
  await drawnText(
    await new RenderQuotePdf().run({
      quote: quote(terms),
      contractor,
      businessName: "Pedro Lawn Care",
      commsLanguage: lang,
    }),
  );

Deno.test("REQ-463 (demo m31) quote PDF: service-wizard terms (no warranty row) → clause 7 never says 'por el período indicado'", async () => {
  const es = await render(SERVICE_TERMS, "es");
  assert(!es.includes("período indicado"), es);
  assertStringIncludes(es, "no incluye una garantía de mano de obra");
  const en = await render(SERVICE_TERMS, "en");
  assert(!en.includes("period stated"), en);
  assertStringIncludes(en, "does not include a workmanship warranty");
});

Deno.test("REQ-463 (demo m31) quote PDF: 'No warranty' picked → the no-warranty body", async () => {
  const es = await render([
    ...SERVICE_TERMS,
    { stepId: "warranty", label: "Warranty", value: "No warranty" },
  ], "es");
  assert(!es.includes("período indicado"), es);
  assertStringIncludes(es, "no incluye una garantía de mano de obra");
});

Deno.test("REQ-463 (demo m31) quote PDF: a 6-month warranty → clause 7 fills in 'por 6 meses'", async () => {
  const es = await render([
    ...SERVICE_TERMS,
    { stepId: "warranty", label: "Warranty", value: "6 months" },
  ], "es");
  assertStringIncludes(es, "garantiza su mano de obra por 6 meses");
  const en = await render([
    ...SERVICE_TERMS,
    { stepId: "warranty", label: "Warranty", value: "6 months" },
  ], "en");
  assertStringIncludes(en, "warrants their workmanship for 6 months");
});
