/**
 * REQ-1102 — LOOP-007 cycle 3, issue q3-26: the quote PDF emailed to the
 * customer is stamped "DRAFT" (in English even on a Spanish quote). The
 * top-right status stamp drew `(quote.status ?? "DRAFT").toUpperCase()` —
 * the raw stored enum, never translated. The stamp is a localized word:
 * `renderQuotePdf.status.<status>` in lang/en.json + lang/es.json, so a
 * Spanish PDF never carries "SENT" / "DRAFT".
 */
import { assert, assertNotEquals, assertStringIncludes } from "#std/assert";
import { decodePDFRawStream, PDFDocument, PDFRawStream } from "#pdf-lib";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { User } from "@users/dto/user.ts";
import { t } from "@core/i18n/mod.ts";
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

function quote(status: string): Quote {
  return {
    id: "4567efab-0000-4000-8000-000000001102",
    userId: "u-1",
    number: "Q-002",
    version: 1,
    status,
    ...(status === "sent" ? { sentAt: "2026-11-18T15:00:00Z" } : {}),
    summary: "Pintura de dormitorios",
    lineItems: [{ description: "Pintura", quantity: 1, price: 500_00 }],
    estimatedTotal: 500_00,
    terms: [],
    createdAt: "2026-11-12T12:00:00Z",
    updatedAt: "2026-11-12T12:00:00Z",
  } as unknown as Quote;
}

const render = async (status: string, lang: "en" | "es") =>
  await drawnText(
    await new RenderQuotePdf().run({
      quote: quote(status),
      contractor,
      businessName: "Pedro Remodeling",
      commsLanguage: lang,
    }),
  );

/** The localized stamp word — must exist in lang/*.json (t falls back to the key). */
function stamp(lang: "en" | "es", status: string): string {
  const key = `renderQuotePdf.status.${status}`;
  const word = t(lang, key);
  assertNotEquals(word, key, `lang/${lang}.json has no "${key}"`);
  return word;
}

Deno.test('REQ-1102 (LOOP-007 q3-26) a sent quote PDF in Spanish is stamped with the Spanish status word, never "SENT" or "DRAFT"', async () => {
  const es = await render("sent", "es");
  assert(!/\bDRAFT\b/.test(es), `the Spanish sent PDF says DRAFT:\n${es}`);
  assert(!/\bSENT\b/.test(es), `the Spanish sent PDF says raw English SENT:\n${es}`);
  assertStringIncludes(es, stamp("es", "sent"));
});

Deno.test('REQ-1102 (LOOP-007 q3-26) a sent quote PDF in English is stamped with the localized sent word, never "DRAFT"', async () => {
  const en = await render("sent", "en");
  assert(!/\bDRAFT\b/.test(en), `the English sent PDF says DRAFT:\n${en}`);
  assertStringIncludes(en, stamp("en", "sent"));
});

Deno.test('REQ-1102 (LOOP-007 q3-26) a draft quote PDF in Spanish (owner preview) says the Spanish draft word, never raw "DRAFT"', async () => {
  const es = await render("draft", "es");
  assert(!/\bDRAFT\b/.test(es), `the Spanish draft PDF says raw English DRAFT:\n${es}`);
  assertStringIncludes(es, stamp("es", "draft"));
});

Deno.test('REQ-1102 (LOOP-007 q3-26) a declined quote PDF in Spanish never carries the raw English "DECLINED"', async () => {
  const es = await render("declined", "es");
  assert(!/\bDECLINED\b/.test(es), `the Spanish declined PDF says raw English DECLINED:\n${es}`);
  assertStringIncludes(es, stamp("es", "declined"));
});
