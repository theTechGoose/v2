/**
 * REQ-1132 (LOOP-007 cycle 3, q3-64): the invoice PDF's hero title is the
 * stored job name, as /i (`invoiceTitle`) and the standalone invoice email
 * print it — never re-cased. The PDF ran the old non-Unicode
 * `.replace(/\b\w/g, c => c.toUpperCase())`, so "Gate repair, Hinge hardware"
 * became "Gate Repair, Hinge Hardware" and "Instalación de baño" became
 * "InstalacióN De BañO" (REQ-720: Spanish is sentence case, accents never
 * mangled).
 */
import { assert, assertEquals } from "#std/assert";
import { RenderInvoicePdf } from "./mod.ts";
import { decodePDFRawStream, PDFDocument, PDFRawStream } from "#pdf-lib";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import { invoiceTitle } from "#documents/linked-view.ts";

/** Every text the PDF draws (inflated content streams, latin1). */
async function drawnText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  let drawn = "";
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      try {
        drawn += new TextDecoder("latin1").decode(
          decodePDFRawStream(obj).decode(),
        );
      } catch { /* an image or font stream */ }
    }
  }
  return drawn;
}

/** Case-SENSITIVE: pdf-lib writes standard-font text as WinAnsi hex
 *  (upper-case hex digits), so compare against the exact hex of `text`. */
function draws(drawn: string, text: string): boolean {
  const hex = [...text].map((c) =>
    c.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase()
  ).join("");
  return drawn.includes(`<${hex}>`) || drawn.includes(`(${text})`);
}

async function renderStandalone(lang: "en" | "es", jobName: string) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const now = new Date().toISOString();
  await (await getKv()).set(["user", "u-1"], {
    id: "u-1",
    phoneNumber: "+15125550108",
    name: "Rosa Díaz",
    email: "rosa@test.dev",
    createdAt: now,
    updatedAt: now,
  });
  const identities = new BusinessIdentityStore();
  await identities.upsert("u-1", {
    businessName: "Díaz Hauling",
    commsLanguage: lang,
  });
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const customer = await customers.create("u-1", {
    name: "Jorge Ruiz",
    email: "jorge.ruiz@example.com",
  });
  const inv = await invoices.create("u-1", {
    customerId: customer.id,
    status: "sent",
    jobName,
    amount: 20_000,
  });
  const render = new RenderInvoicePdf(
    invoices,
    new QuoteStore(),
    customers,
    new UserStore(),
    identities,
  );
  return await drawnText(await render.run(inv.id));
}

const CASES = [
  {
    lang: "en" as const,
    jobName: "Gate repair, Hinge hardware",
    recased: "Gate Repair, Hinge Hardware",
  },
  {
    lang: "es" as const,
    jobName: "Instalación de baño",
    recased: "InstalacióN De BañO",
  },
];

for (const c of CASES) {
  Deno.test(`REQ-1132 q3-64 render-invoice-pdf: a standalone ${c.lang} invoice's PDF hero is "${c.jobName}" exactly as /i titles it — not "${c.recased}"`, async () => {
    try {
      const drawn = await renderStandalone(c.lang, c.jobName);
      // /i's title for the same invoice (front-end/routes/i/[id].tsx)
      const pageTitle = invoiceTitle(
        { jobName: c.jobName, number: "INV-001" },
        c.lang,
      );
      assertEquals(pageTitle, c.jobName, "setup: /i prints the stored name");
      assert(
        !draws(drawn, c.recased),
        `the PDF re-cases the title to "${c.recased}"`,
      );
      assert(
        draws(drawn, pageTitle),
        `the PDF hero draws "${pageTitle}" character for character, as /i`,
      );
    } finally {
      await resetKv();
    }
  });
}
