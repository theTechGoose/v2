/**
 * REQ-783 — demo-loop cycle dv1, issue d4. Raphael: "Yes, default terms."
 * The quote PDF keeps "CANCELLATION 7 days' notice" by default and prints
 * the notice the owner set in the quote review when they changed or removed
 * it — one cell, never the default beside the edit — and clause 10
 * (Termination) states the same notice.
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
  return out.replace(/\s*\n\s*/g, " ");
}

const contractor = {
  id: "u-783",
  name: "Bob",
  phoneNumber: "+15125550783",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as User;

const WIZARD_TERMS = [
  { stepId: "start_date", label: "Start date", value: "Right away" },
  { stepId: "wraps", label: "Time to complete", value: "1 week" },
  { stepId: "payment_terms", label: "Payment terms", value: "50/50" },
  { stepId: "warranty", label: "Warranty", value: "1 year" },
];
const cancel = (value: string) => ({
  stepId: "cancellation",
  label: "Cancellation",
  value,
});

function quote(terms: Quote["terms"]): Quote {
  return {
    id: "4567efab-0000-4000-8000-000000000783",
    userId: "u-783",
    number: "Q-783",
    version: 1,
    status: "sent",
    summary: "Bathroom floor",
    lineItems: [{ description: "Porcelain tile", quantity: 1, price: 2400_00 }],
    estimatedTotal: 2400_00,
    terms,
    createdAt: "2026-11-13T12:00:00Z",
    updatedAt: "2026-11-13T12:00:00Z",
  } as unknown as Quote;
}

const render = async (terms: Quote["terms"], lang: "en" | "es") =>
  await drawnText(
    await new RenderQuotePdf().run({
      quote: quote(terms),
      contractor,
      businessName: "Bob's Tile",
      commsLanguage: lang,
    }),
  );

const count = (s: string, needle: string) => s.split(needle).length - 1;

Deno.test("REQ-783 d4 quote PDF: the default stays — 'CANCELLATION' '7 days' notice' and clause 10's 7 days (en + es)", async () => {
  const en = await render(WIZARD_TERMS, "en");
  assertStringIncludes(en, "CANCELLATION");
  assertStringIncludes(en, "7 days' notice");
  assertStringIncludes(en, "7 days' written notice");
  const es = await render(WIZARD_TERMS, "es");
  assertStringIncludes(es, "Aviso de 7 días");
});

Deno.test("REQ-783 d4 quote PDF: the owner's 14-day edit is the one cancellation cell, and clause 10 says 14 days", async () => {
  const en = await render([...WIZARD_TERMS, cancel("14 days' notice")], "en");
  assertStringIncludes(en, "14 days' notice");
  assertStringIncludes(en, "14 days' written notice");
  assert(!en.includes("7 days"), `no 7-day default beside the edit: ${en}`);
  assert(count(en, "CANCELLATION") === 1, `one cancellation cell: ${en}`);
  const es = await render([...WIZARD_TERMS, cancel("Aviso de 14 días")], "es");
  assertStringIncludes(es, "Aviso de 14 días");
  assert(!es.includes("7 días"), es);
});

Deno.test("REQ-783 d4 quote PDF: a removed notice prints 'No notice period' and no 7 days", async () => {
  const en = await render([...WIZARD_TERMS, cancel("No notice period")], "en");
  assertStringIncludes(en, "No notice period");
  assert(!en.includes("7 days"), en);
});
