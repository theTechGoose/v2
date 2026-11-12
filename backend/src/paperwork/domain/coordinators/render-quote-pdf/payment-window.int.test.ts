/**
 * REQ-697 — demo-loop cycle 5, issue m22: "'Pago al finalizar' became an
 * invoice due 30 days later; the signed agreement only said 'Pago al
 * finalizar'" (pair 9). Signing schedules the completion bill due the
 * account's days to pay after it goes out (REQ-411), so the agreement's
 * payment term states that window — on the PDF as on the /q page.
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
  id: "u-1",
  name: "Rosa",
  phoneNumber: "+15125550000",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as User;

function quote(payment: string): Quote {
  return {
    id: "4567efab-0000-4000-8000-000000000697",
    userId: "u-1",
    number: "Q-001",
    version: 1,
    status: "sent",
    summary: "Retiro de escombros",
    lineItems: [{ description: "Retiro", quantity: 1, price: 525_00 }],
    estimatedTotal: 525_00,
    terms: [
      { stepId: "start_date", label: "Start date", value: "Next week" },
      { stepId: "payment_terms", label: "Payment terms", value: payment },
    ],
    createdAt: "2026-11-12T12:00:00Z",
    updatedAt: "2026-11-12T12:00:00Z",
  } as unknown as Quote;
}

const render = async (
  payment: string,
  lang: "en" | "es",
  invoiceNetDays?: number,
) =>
  await drawnText(
    await new RenderQuotePdf().run({
      quote: quote(payment),
      contractor,
      businessName: "Rosa Hauling",
      commsLanguage: lang,
      ...(invoiceNetDays !== undefined ? { invoiceNetDays } : {}),
    }),
  );

Deno.test("REQ-697 (demo c5 m22) quote PDF: 'Payment upon completion' states the account's days to pay", async () => {
  const es = await render("Payment upon completion", "es", 30);
  assertStringIncludes(es, "Pago al finalizar");
  assertStringIncludes(es, "vence 30 días después de la factura");
  const en = await render("Payment upon completion", "en", 15);
  assertStringIncludes(en, "Payment upon completion");
  assertStringIncludes(en, "due within 15 days of the invoice");
});

Deno.test("REQ-697 (demo c5 m22) quote PDF: other payment terms carry no window", async () => {
  const en = await render("50/50", "en", 30);
  assert(!en.includes("days of the invoice"), en);
});
