/**
 * REQ-1130 (LOOP-007 q3, q3-59) — Raphael: "test every single aspect of this
 * application … one Opus agent per issue to do root cause analysis, then one
 * to write the test, then one to fix it and make it green."
 *
 * The invoice PDF of an overpaid invoice ($1,100 on $1,035.50) draws the
 * REQ-202 overpaid flag. It must not add "we will refund or credit this"
 * (es "lo reembolsaremos o acreditaremos") — a promise the owner never made.
 */
import { assert } from "#std/assert";
import { RenderInvoicePdf } from "./mod.ts";
import { decodePDFRawStream, PDFDocument, PDFRawStream } from "#pdf-lib";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";

const hexOf = (s: string) =>
  [...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("").toUpperCase();

async function drawnUpper(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  let drawn = "";
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      try {
        drawn += new TextDecoder("latin1").decode(decodePDFRawStream(obj).decode());
      } catch { /* not text */ }
    }
  }
  return drawn.toUpperCase();
}

const has = (up: string, s: string) => up.includes(s.toUpperCase()) || up.includes(hexOf(s));

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-1130 (q3-59) render-invoice-pdf ${lang}: an overpaid invoice's PDF flags $64.50 without a refund-or-credit promise`, async () => {
    Deno.env.set("KV_PATH", ":memory:");
    await resetKv();
    try {
      const invoices = new InvoiceStore();
      const customers = new CustomerStore();
      const identities = new BusinessIdentityStore();
      const now = new Date().toISOString();
      await (await getKv()).set(["user", "u-1"], {
        id: "u-1",
        phoneNumber: "+15125550000",
        name: "Test Contractor",
        email: "me@test.dev",
        createdAt: now,
        updatedAt: now,
      });
      await identities.upsert("u-1", { businessName: "Ortega Floors LLC", commsLanguage: lang } as never);
      const customer = await customers.create("u-1", { name: "Maria Lopez", email: "maria@acme.test" });
      const inv = await invoices.create("u-1", {
        customerId: customer.id,
        jobName: "Kitchen floor",
        amount: 103_550,
        status: "paid",
        paidAt: "2026-11-15T00:00:00.000Z",
        paidCents: 110_000,
        overpaidCents: 6_450,
        // deno-lint-ignore no-explicit-any
      } as any);
      const bytes = await new RenderInvoicePdf(invoices, new QuoteStore(), customers, new UserStore(), identities)
        .run(inv.id);
      const up = await drawnUpper(bytes);
      assert(has(up, "$64.50"), "the PDF still flags the $64.50 overpayment (REQ-202)");
      for (const word of ["refund", "credit", "reembols", "acredit"]) {
        assert(!has(up, word), `${lang}: the PDF promises "${word}" on the owner's behalf`);
      }
    } finally {
      await resetKv();
    }
  });
}
