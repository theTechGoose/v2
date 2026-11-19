/**
 * REQ-1136 (LOOP-007 cycle 3, q3-62) — a cancelled (void) invoice's PDF never
 * says "AMOUNT DUE": /i says "Cancelled — nothing due · $0.00" (REQ-627) and
 * the downloaded PDF (GET /api/invoices/:id/pdf → RenderInvoicePdf) must agree.
 * The money card reads the cancelled label and $0.00, no "Due <date>", no
 * full amount, and the REQ-206 "Payment instructions" row is not printed.
 */
import { assertEquals } from "#std/assert";
import { RenderInvoicePdf } from "./mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { CustomerStore } from "@crm/domain/data/customer-store/mod.ts";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import { pdfFacts } from "@paperwork/domain/business/pdf-logo/inspect.ts";

const INSTRUCTIONS = "Mail a check to PO Box 7731";

async function renderVoided(commsLanguage: "en" | "es"): Promise<string[]> {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const kv = await getKv();
  const now = new Date().toISOString();
  await kv.set(["user", "u-1"], {
    id: "u-1",
    phoneNumber: "+15125550000",
    name: "Alexander Jerez",
    email: "me@test.dev",
    createdAt: now,
    updatedAt: now,
  });
  const invoices = new InvoiceStore();
  const customers = new CustomerStore();
  const identities = new BusinessIdentityStore();
  await identities.upsert("u-1", {
    businessName: "A2Z Landscape LLC",
    commsLanguage,
  } as never);
  const customer = await customers.create("u-1", {
    name: "Randall Belknap",
    email: "rb@acme.test",
  });
  // an amount-only sent bill, as INV-003 in the run: $225.30 due October 8
  const inv = await invoices.create("u-1", {
    customerId: customer.id,
    status: "sent",
    jobName: "Spring cleanup",
    amount: 22530,
    issuedDate: "2026-09-23",
    dueDate: "2026-10-08",
    paymentInstructions: INSTRUCTIONS,
    // deno-lint-ignore no-explicit-any
  } as any);
  // voided the way the controller's removeOne does it (REQ-627)
  await invoices.update(inv.id, "u-1", {
    status: "void",
    voidedAt: new Date().toISOString(),
    voidReason: "Wrong address",
    // deno-lint-ignore no-explicit-any
  } as any);
  const bytes = await new RenderInvoicePdf(
    invoices,
    new QuoteStore(),
    customers,
    new UserStore(),
    identities,
  ).run(inv.id);
  const f = await pdfFacts(bytes);
  await resetKv();
  // WinAnsi 0x97 is the em dash
  return f.text.replaceAll("\u0097", "—").split("\n").map((s) => s.trim())
    .filter(Boolean);
}

for (
  const [lang, want] of [
    ["en", {
      cancelled: "Cancelled — nothing due",
      amountDue: "Amount due",
      dueOn: "Due October",
    }],
    ["es", {
      cancelled: "Cancelada — no se debe nada",
      amountDue: "Monto a pagar",
      dueOn: "Vence ",
    }],
  ] as const
) {
  Deno.test(`REQ-1136 q3-62 render-invoice-pdf (${lang}): a voided invoice's PDF says '${want.cancelled}' and $0.00 — not '${want.amountDue}', not '${want.dueOn}…', not $225.30, no payment instructions`, async () => {
    const lines = await renderVoided(lang);
    const low = lines.map((l) => l.toLowerCase());
    const wrong: string[] = [];
    if (!low.includes(want.cancelled.toLowerCase())) {
      wrong.push(`the money card does not read '${want.cancelled}'`);
    }
    if (!lines.includes("$0.00")) {
      wrong.push("the money card's figure is not $0.00");
    }
    if (low.includes(want.amountDue.toLowerCase())) {
      wrong.push(`the money card reads '${want.amountDue.toUpperCase()}'`);
    }
    const due = lines.find((l) => l.startsWith(want.dueOn));
    if (due) wrong.push(`the money card reads '${due}'`);
    if (lines.includes("$225.30")) {
      wrong.push("the full amount $225.30 is printed as owed");
    }
    if (lines.some((l) => l.includes("PO Box 7731"))) {
      wrong.push(`the payment instructions '${INSTRUCTIONS}' are printed`);
    }
    assertEquals(
      wrong,
      [],
      `${lang}: the cancelled invoice's PDF disagrees with /i — drawn: ${
        JSON.stringify(lines)
      }`,
    );
  });
}
