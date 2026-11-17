/**
 * REQ-556 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 4, issue M7: after a payment closed an invoice,
 * /invoices said "El recibo se envió automáticamente." for a client with no
 * email. MarkInvoicePaid emailed the PAID invoice, logged any failure and
 * stored nothing, so no page could know whether a receipt went out.
 *
 * It now records the result on the invoice: `receiptSentVia` "email" when the
 * email was delivered, "none" when it was not (no address, refused, thrown).
 */
import { assertEquals } from "#std/assert";
import { MarkInvoicePaid } from "./mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import type {
  SendPaperworkEmail,
  SendPaperworkEmailResult,
} from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

function emailer(answer: () => Promise<SendPaperworkEmailResult>) {
  return { run: answer } as unknown as SendPaperworkEmail;
}

async function paidInvoice(invoices: InvoiceStore) {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  return await invoices.create(
    "u-556",
    {
      amount: 450_00,
      status: "paid",
      dueDate: "2026-11-19",
    } as unknown as Parameters<InvoiceStore["create"]>[1],
  );
}

Deno.test("REQ-556 (M7) MarkInvoicePaid: the paid email was delivered → receiptSentVia 'email'", async () => {
  const invoices = new InvoiceStore();
  try {
    const inv = await paidInvoice(invoices);
    await new MarkInvoicePaid(
      emailer(() =>
        Promise.resolve({ ok: true, to: "a@example.com", subject: "s" })
      ),
      invoices,
    ).run("u-556", inv.id);
    assertEquals((await invoices.get(inv.id)).receiptSentVia, "email");
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-556 (M7) MarkInvoicePaid: no address on file (the email is refused) → receiptSentVia 'none'", async () => {
  const invoices = new InvoiceStore();
  try {
    const inv = await paidInvoice(invoices);
    await new MarkInvoicePaid(
      emailer(() =>
        Promise.resolve({
          ok: false,
          reason: "no recipient",
          to: "",
          subject: "s",
        })
      ),
      invoices,
    ).run("u-556", inv.id);
    assertEquals((await invoices.get(inv.id)).receiptSentVia, "none");
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-556 (M7) MarkInvoicePaid: the email throws → receiptSentVia 'none', the payment is not broken", async () => {
  const invoices = new InvoiceStore();
  try {
    const inv = await paidInvoice(invoices);
    await new MarkInvoicePaid(
      emailer(() => Promise.reject(new Error("postmark down"))),
      invoices,
    ).run("u-556", inv.id);
    const after = await invoices.get(inv.id);
    assertEquals(after.receiptSentVia, "none");
    assertEquals(after.status, "paid");
  } finally {
    await resetKv();
  }
});
