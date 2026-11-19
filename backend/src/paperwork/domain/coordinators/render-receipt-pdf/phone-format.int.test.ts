/**
 * REQ-965 — LOOP-007 cycle 1, issue q1-42 (same defect, receipt PDF): the
 * receipt's footer contact line prints the contractor's phone as
 * "(512) 555-0703", never the stored "+15125550703".
 */
import { assert, assertStringIncludes } from "#std/assert";
import { decodePDFRawStream, PDFDocument, PDFRawStream } from "#pdf-lib";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import type { User } from "@users/dto/user.ts";
import type { Customer } from "@crm/dto/customer.ts";
import { RenderReceiptPdf } from "./mod.ts";

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

Deno.test("REQ-965 (q1-42) receipt PDF: the footer contact line prints the contractor's '+15125550703' as '(512) 555-0703'", async () => {
  const bytes = await new RenderReceiptPdf().run({
    invoice: {
      id: "inv-965",
      userId: "u-1",
      customerId: "c-1",
      number: "INV-965",
      version: 1,
      status: "paid",
      jobName: "Roof repair",
      amount: 500_00,
      createdAt: "2026-11-18T12:00:00Z",
      updatedAt: "2026-11-18T12:00:00Z",
    } as unknown as Invoice,
    customer: {
      id: "c-1",
      userId: "u-1",
      name: "Dana Pruitt",
      phoneNumber: "8435550277",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    } as unknown as Customer,
    contractor: {
      id: "u-1",
      name: "Marcus Reyes",
      email: "marcus@test.dev",
      phoneNumber: "+15125550703",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    } as User,
    businessName: "Reyes Roofing",
    amount: 500_00,
    method: "check",
    confirmedAt: "2026-11-18T12:00:00Z",
    lang: "en",
  });
  const text = await drawnText(bytes);
  assertStringIncludes(text, "(512) 555-0703", "the footer's phone, formatted");
  assert(!text.includes("+1512"), `no raw E.164 contractor phone:\n${text}`);
  assert(!text.includes("8435550277"), `no raw customer digits:\n${text}`);
});
