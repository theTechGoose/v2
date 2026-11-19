/**
 * REQ-965 — LOOP-007 cycle 1, issue q1-42 ("PDFs print phone numbers
 * unformatted"): the invoice PDF draws the contractor's phone (stored E.164)
 * and the customer's phone (stored as typed) the way the web pages show them —
 * "(512) 555-0702", "(843) 555-0142" — never "+15125550702" / "843-555-0142".
 */
import { assert, assertStringIncludes } from "#std/assert";
import { decodePDFRawStream, PDFDocument, PDFRawStream } from "#pdf-lib";
import { RenderInvoicePdf } from "./mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";

/** Every string pdf-lib drew (hex-string / literal Tj operators), one per line. */
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

Deno.test("REQ-965 (q1-42) invoice PDF: FROM prints the contractor's '+15125550702' as '(512) 555-0702' and BILL TO prints '843-555-0142' as '(843) 555-0142'", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    const kv = await getKv();
    const now = new Date().toISOString();
    await kv.set(["user", "u-1"], {
      id: "u-1",
      phoneNumber: "+15125550702",
      name: "Marcus Reyes",
      email: "marcus@test.dev",
      createdAt: now,
      updatedAt: now,
    });
    const identities = new BusinessIdentityStore();
    await identities.upsert("u-1", { businessName: "Reyes Roofing" });
    const customers = new CustomerStore();
    const customer = await customers.create("u-1", {
      name: "Dana Pruitt",
      email: "dana@example.com",
      phoneNumber: "843-555-0142",
    });
    const invoices = new InvoiceStore();
    const inv = await invoices.create("u-1", {
      customerId: customer.id,
      status: "sent",
      jobName: "Roof repair",
      lineItems: [{ description: "Roof repair", quantity: 1, unit: "job", price: 50000 }],
      amount: 50000,
    });
    const bytes = await new RenderInvoicePdf(
      invoices,
      new QuoteStore(),
      customers,
      new UserStore(),
      identities,
    ).run(inv.id);
    const text = await drawnText(bytes);
    assertStringIncludes(text, "(512) 555-0702", "FROM: the contractor's phone, formatted");
    assertStringIncludes(text, "(843) 555-0142", "BILL TO: the customer's phone, formatted");
    assert(!text.includes("+1512"), `no raw E.164 contractor phone:\n${text}`);
    assert(!text.includes("843-555-0142"), `no as-typed customer phone:\n${text}`);
  } finally {
    await resetKv();
  }
});
