/**
 * REQ-941 (LOOP-007 cycle 1, q1-7) — Raphael: "test every single aspect of
 * this application … one Opus agent per issue to do root cause analysis, then
 * one to write the test, then one to fix it and make it green."
 *
 * MarkInvoicePaid records receiptSentVia "email" whenever its paid-invoice
 * email is delivered, and /i turns "email" into "A PDF receipt is in your
 * inbox". The email it sends carries no attachment, so "email" must only be
 * recorded when the email it sent actually carried a PDF receipt.
 */
import { assert } from "#std/assert";
import { MarkInvoicePaid } from "./mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import type { SendPaperworkEmail } from "@paperwork/domain/coordinators/send-paperwork-email/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

Deno.test("REQ-941 (LOOP-007 q1-7) MarkInvoicePaid: receiptSentVia 'email' only when the delivered email carried a PDF receipt", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const invoices = new InvoiceStore();
  try {
    const inv = await invoices.create(
      "u-941",
      {
        amount: 1250_00,
        status: "paid",
        dueDate: "2026-12-01",
        paidAt: "2026-11-17T15:00:00.000Z",
      } as unknown as Parameters<InvoiceStore["create"]>[1],
    );
    const asked: Record<string, unknown>[] = [];
    const emailer = {
      run: (_u: string, input: Record<string, unknown>) => {
        asked.push(input);
        return Promise.resolve({ ok: true, to: "a@example.com", subject: "s" });
      },
    } as unknown as SendPaperworkEmail;
    await new MarkInvoicePaid(emailer, invoices).run("u-941", inv.id);
    const via = (await invoices.get(inv.id)).receiptSentVia;
    const pdfSent = asked.some((i) =>
      Array.isArray(i.attachments) &&
      (i.attachments as { contentType?: string }[]).some((a) =>
        a.contentType === "application/pdf"
      )
    );
    assert(
      via !== "email" || pdfSent,
      `receiptSentVia is "${via}" but the paid email had no PDF attachment (asked: ${
        JSON.stringify(asked)
      })`,
    );
  } finally {
    await resetKv();
  }
});
