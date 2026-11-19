/**
 * REQ-968 — LOOP-007 cycle 1, issue q1-45: the quote PDF numbered its
 * sections 01, 02, 04, 05, 06 on a quote with no start date and no
 * completion date. Each section number was a hardcoded literal, so the
 * skipped Schedule section took "03" with it. The web document numbers the
 * same sections without gaps (front-end/components/quote-doc.tsx); the PDF
 * must too: the section discs read 01, 02, … in order with no gap.
 */
import { assertEquals } from "#std/assert";
import { decodePDFRawStream, PDFDocument, PDFRawStream } from "#pdf-lib";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { User } from "@users/dto/user.ts";
import { RenderQuotePdf } from "./mod.ts";

/** Every string pdf-lib drew, one per Tj operator, in drawing order. */
async function drawnLines(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const out: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    let s: string;
    try {
      s = new TextDecoder("latin1").decode(decodePDFRawStream(obj).decode());
    } catch {
      continue;
    }
    for (
      const m of s.matchAll(
        /<([0-9A-Fa-f]+)>\s*Tj|\(((?:[^()\\]|\\.)*)\)\s*Tj/g,
      )
    ) {
      if (m[1] !== undefined) {
        let line = "";
        for (let i = 0; i + 1 < m[1].length; i += 2) {
          line += String.fromCharCode(parseInt(m[1].slice(i, i + 2), 16));
        }
        out.push(line);
      } else out.push(m[2]);
    }
  }
  return out;
}

/** The section-disc numbers ("01", "02", …) in the order they were drawn,
 *  each paired with the title drawn right after it. */
async function sectionHeaders(bytes: Uint8Array): Promise<string[]> {
  const lines = await drawnLines(bytes);
  const out: string[] = [];
  lines.forEach((l, i) => {
    if (/^\d\d$/.test(l.trim())) out.push(`${l.trim()} ${lines[i + 1] ?? ""}`);
  });
  return out;
}

const contractor = {
  id: "u-1",
  name: "Pedro",
  phoneNumber: "+15125550000",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as User;

const TERMS = [
  { stepId: "payment_terms", label: "Payment terms", value: "50% upfront" },
  { stepId: "warranty", label: "Warranty", value: "1 year" },
];

function quote(extra: Partial<Quote>): Quote {
  return {
    id: "89f42fb1-0000-4000-8000-000000000045",
    userId: "u-1",
    number: "Q-045",
    version: 1,
    status: "sent",
    summary: "Kitchen remodel",
    lineItems: [{ description: "Cabinets", quantity: 1, price: 4_000_00 }],
    estimatedTotal: 4_000_00,
    terms: TERMS,
    createdAt: "2026-11-12T12:00:00Z",
    updatedAt: "2026-11-12T12:00:00Z",
    ...extra,
  } as unknown as Quote;
}

const render = async (extra: Partial<Quote>) =>
  await sectionHeaders(
    await new RenderQuotePdf().run({
      quote: quote(extra),
      contractor,
      businessName: "Pedro Remodeling",
      commsLanguage: "en",
    }),
  );

const numbersOf = (headers: string[]) => headers.map((h) => h.slice(0, 2));

Deno.test("REQ-968 (LOOP-007 q1-45) quote PDF: no start/completion date → section numbers run 01–05 with no gap (no 06)", async () => {
  const headers = await render({});
  assertEquals(
    numbersOf(headers),
    ["01", "02", "03", "04", "05"],
    `section headers drawn: ${JSON.stringify(headers)}`,
  );
});

Deno.test("REQ-968 (LOOP-007 q1-45) quote PDF: with a start and completion date → section numbers run 01–06", async () => {
  const headers = await render({
    startDate: "2026-12-01",
    estimatedCompletionDate: "2026-12-15",
  } as Partial<Quote>);
  assertEquals(
    numbersOf(headers),
    ["01", "02", "03", "04", "05", "06"],
    `section headers drawn: ${JSON.stringify(headers)}`,
  );
});
