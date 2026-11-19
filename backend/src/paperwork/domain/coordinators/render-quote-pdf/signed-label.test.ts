/**
 * REQ-967 — LOOP-007 cycle 1, issue q1-44: the countersigned agreement PDF
 * titled the customer's box "YOUR SIGNATURE" above "Linda Park", while /q
 * says "LINDA PARK'S SIGNATURE" (REQ-692). Once the quote is signed, the
 * PDF's customer box carries the signer's name ("LINDA PARK'S SIGNATURE" /
 * "FIRMA DE LINDA PARK"); "YOUR SIGNATURE" stays only on the unsigned
 * prompt (REQ-032).
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
  return out;
}

const contractor = {
  id: "u-1",
  name: "Pedro",
  phoneNumber: "+15125550000",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as User;

function quote(signed: boolean): Quote {
  return {
    id: "4567efab-0000-4000-8000-000000000044",
    userId: "u-1",
    number: "Q-001",
    version: 1,
    status: signed ? "accepted" : "sent",
    summary: "Kitchen remodel",
    lineItems: [{ description: "Remodel", quantity: 1, price: 1_200_00 }],
    estimatedTotal: 1_200_00,
    terms: [],
    ...(signed
      ? { acceptedName: "Linda Park", acceptedAt: "2026-11-17T15:00:00Z" }
      : {}),
    createdAt: "2026-11-12T12:00:00Z",
    updatedAt: "2026-11-12T12:00:00Z",
  } as unknown as Quote;
}

const render = async (signed: boolean, lang: "en" | "es") =>
  await drawnText(
    await new RenderQuotePdf().run({
      quote: quote(signed),
      contractor,
      businessName: "Pedro Remodeling",
      commsLanguage: lang,
    }),
  );

Deno.test('REQ-967 (LOOP-007 q1-44) signed quote PDF (en): the customer box says "LINDA PARK\'S SIGNATURE", never "YOUR SIGNATURE"', async () => {
  const en = await render(true, "en");
  assertStringIncludes(en, "Linda Park", "the signer's name is drawn");
  assertStringIncludes(en, "LINDA PARK'S SIGNATURE");
  assert(!en.includes("YOUR SIGNATURE"), en);
});

Deno.test('REQ-967 (LOOP-007 q1-44) signed quote PDF (es): the customer box says "FIRMA DE LINDA PARK", never "TU FIRMA"', async () => {
  const es = await render(true, "es");
  assertStringIncludes(es, "FIRMA DE LINDA PARK");
  assert(!es.includes("TU FIRMA"), es);
});

Deno.test('REQ-967 (LOOP-007 q1-44) unsigned quote PDF keeps the REQ-032 prompt "YOUR SIGNATURE" / "TU FIRMA"', async () => {
  assertStringIncludes(await render(false, "en"), "YOUR SIGNATURE");
  assertStringIncludes(await render(false, "es"), "TU FIRMA");
});
