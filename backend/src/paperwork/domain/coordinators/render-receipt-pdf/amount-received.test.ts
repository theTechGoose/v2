/**
 * REQ-1110 — LOOP-007 cycle 3, issue q3-34: a part-payment receipt PDF said
 * "AMOUNT RECEIVED $1,000.50" for a $400.25 check, while the email it rode
 * with said "payment of $400.25 … Balance still due: $600.25 of $1,000.50".
 *
 * RenderReceiptPdf prints `invoice.amount` (the bill's total) in the amount
 * card and its input has no field for the money actually received. These
 * tests render the receipt for the payment and read the drawn text.
 */
import { assert, assertStringIncludes } from "#std/assert";
import { decodePDFRawStream, PDFDocument, PDFRawStream } from "#pdf-lib";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import type { User } from "@users/dto/user.ts";
import type { Customer } from "@crm/dto/customer.ts";
import { RenderReceiptPdf, type RenderReceiptPdfInput } from "./mod.ts";

/** every string the PDF draws, one per line, in drawing order */
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

const invoice = {
  id: "inv-1110",
  userId: "u-1",
  customerId: "c-1",
  number: "INV-002",
  version: 1,
  status: "sent",
  jobName: "Fence repair",
  amount: 1_000_50,
  paidCents: 400_25,
  createdAt: "2026-11-19T12:00:00Z",
  updatedAt: "2026-11-19T12:00:00Z",
} as unknown as Invoice;

const base = {
  invoice,
  customer: {
    id: "c-1",
    userId: "u-1",
    name: "Greg Pruitt",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as unknown as Customer,
  contractor: {
    id: "u-1",
    name: "Whitfield Fence & Deck",
    email: "owner@test.dev",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as User,
  businessName: "Whitfield Fence & Deck",
  method: "check" as const,
  reference: "Check #1042",
  confirmedAt: "2026-11-19T12:00:00Z",
  lang: "en" as const,
};

/** the line drawn right after the "AMOUNT RECEIVED" / "MONTO RECIBIDO" label */
function amountLine(text: string, label: RegExp): string | undefined {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => label.test(l));
  return i < 0 ? undefined : lines[i + 1];
}

Deno.test("REQ-1110 (LOOP-007 q3, q3-34) receipt PDF: a $400.25 part payment on a $1,000.50 invoice reads AMOUNT RECEIVED $400.25, never the $1,000.50 total", async () => {
  const bytes = await new RenderReceiptPdf().run({
    ...base,
    // the money this receipt is for, plus the bill's state after it
    amount: 400_25,
    totalCents: 1_000_50,
    balanceCents: 600_25,
  } as unknown as RenderReceiptPdfInput);
  const text = await drawnText(bytes);
  const shown = amountLine(text, /AMOUNT RECEIVED/i);
  assert(
    shown === "$400.25",
    `the amount received is the $400.25 paid — got ${
      JSON.stringify(shown)
    }; drawn text:\n${text}`,
  );
});

Deno.test("REQ-1110 (LOOP-007 q3, q3-34) receipt PDF: a part-payment receipt shows the $600.25 balance still due of the $1,000.50 total", async () => {
  const bytes = await new RenderReceiptPdf().run({
    ...base,
    amount: 400_25,
    totalCents: 1_000_50,
    balanceCents: 600_25,
  } as unknown as RenderReceiptPdfInput);
  const text = await drawnText(bytes);
  assertStringIncludes(text, "$600.25", "the balance still due");
  assertStringIncludes(text, "$1,000.50", "the invoice total, as context");
});

Deno.test("REQ-1110 (LOOP-007 q3, q3-34) receipt PDF (es): un abono de $400.25 dice $400.25 recibido, no el total", async () => {
  const bytes = await new RenderReceiptPdf().run({
    ...base,
    lang: "es",
    amount: 400_25,
    totalCents: 1_000_50,
    balanceCents: 600_25,
  } as unknown as RenderReceiptPdfInput);
  const text = await drawnText(bytes);
  const lines = text.split("\n");
  assert(lines.includes("$400.25"), `the $400.25 paid is drawn:\n${text}`);
  assertStringIncludes(text, "$600.25", "el saldo pendiente");
});
