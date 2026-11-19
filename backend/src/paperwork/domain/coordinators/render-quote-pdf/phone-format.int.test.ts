/**
 * REQ-965 — LOOP-007 cycle 1, issue q1-42 ("PDFs print phone numbers
 * unformatted"): the quote / signed-agreement PDF draws the contractor's
 * phone (stored E.164) and the customer's phone (stored as typed) the way the
 * web pages show them — "(512) 555-0701", "(843) 555-0277".
 */
import { assert, assertStringIncludes } from "#std/assert";
import { decodePDFRawStream, PDFDocument, PDFRawStream } from "#pdf-lib";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { User } from "@users/dto/user.ts";
import type { Customer } from "@crm/dto/customer.ts";
import { RenderQuotePdf } from "./mod.ts";

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
  name: "Marcus Reyes",
  email: "marcus@test.dev",
  phoneNumber: "+15125550701",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as User;

const customer = {
  id: "c-1",
  userId: "u-1",
  name: "Dana Pruitt",
  email: "dana@example.com",
  phoneNumber: "8435550277",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as unknown as Customer;

const quote = {
  id: "4567efab-0000-4000-8000-000000000965",
  userId: "u-1",
  customerId: "c-1",
  number: "Q-965",
  version: 1,
  status: "accepted",
  acceptedAt: "2026-11-18T12:00:00Z",
  acceptedName: "Dana Pruitt",
  summary: "Roof repair",
  lineItems: [{ description: "Roof repair", quantity: 1, price: 500_00 }],
  estimatedTotal: 500_00,
  terms: [],
  createdAt: "2026-11-18T12:00:00Z",
  updatedAt: "2026-11-18T12:00:00Z",
} as unknown as Quote;

Deno.test("REQ-965 (q1-42) quote / signed-agreement PDF: the contractor's '+15125550701' prints '(512) 555-0701' and the customer's '8435550277' prints '(843) 555-0277'", async () => {
  const text = await drawnText(
    await new RenderQuotePdf().run({
      quote,
      customer,
      contractor,
      businessName: "Reyes Roofing",
      commsLanguage: "en",
    }),
  );
  assertStringIncludes(text, "(512) 555-0701", "the contractor's phone, formatted");
  assertStringIncludes(text, "(843) 555-0277", "the customer's phone, formatted");
  assert(!text.includes("+1512"), `no raw E.164 contractor phone:\n${text}`);
  assert(!text.includes("8435550277"), `no raw customer digits:\n${text}`);
});
