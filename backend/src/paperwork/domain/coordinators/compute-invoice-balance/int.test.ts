import { assertEquals } from "#std/assert";
import { ComputeInvoiceBalance } from "./mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { PaymentStore } from "@paperwork/domain/data/payment-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

function fresh() {
  const invoices = new InvoiceStore();
  const payments = new PaymentStore();
  const flow = new ComputeInvoiceBalance(invoices, payments);
  return { flow, invoices, payments };
}

Deno.test("compute-invoice-balance: payment closing the balance flips status to paid", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, invoices, payments } = fresh();
  const inv = await invoices.create("u-1", {
    contractId: "c-1", dueDate: "2026-05-01", amount: 100, status: "pending",
  });
  await payments.create("u-1", {
    invoiceId: inv.id, amount: 100, method: "cash", receivedAt: "2026-04-15T00:00:00.000Z",
  });

  const result = await flow.run(inv.id, "u-1");
  assertEquals(result.balance, 0);
  assertEquals(result.status, "paid");
  const after = await invoices.getOwned(inv.id, "u-1");
  assertEquals(after.status, "paid");
  assertEquals(after.paidAt, "2026-04-15T00:00:00.000Z");
  await resetKv();
});

Deno.test("compute-invoice-balance: partial payment leaves status pending", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, invoices, payments } = fresh();
  const inv = await invoices.create("u-1", {
    contractId: "c-1", dueDate: "2026-05-01", amount: 100, status: "pending",
  });
  await payments.create("u-1", {
    invoiceId: inv.id, amount: 30, method: "check", receivedAt: "2026-04-10T00:00:00.000Z",
  });

  const result = await flow.run(inv.id, "u-1");
  assertEquals(result.paidTotal, 30);
  assertEquals(result.balance, 70);
  assertEquals(result.status, "pending");
  await resetKv();
});

Deno.test("compute-invoice-balance: deleting the closing payment reopens the invoice", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, invoices, payments } = fresh();
  const inv = await invoices.create("u-1", {
    contractId: "c-1", dueDate: "2026-05-01", amount: 100, status: "pending",
  });
  const p = await payments.create("u-1", {
    invoiceId: inv.id, amount: 100, method: "card", receivedAt: "2026-04-15T00:00:00.000Z",
  });
  await flow.run(inv.id, "u-1");
  assertEquals((await invoices.getOwned(inv.id, "u-1")).status, "paid");

  await payments.delete(p.id, "u-1");
  await flow.run(inv.id, "u-1");
  assertEquals((await invoices.getOwned(inv.id, "u-1")).status, "pending");
  await resetKv();
});

Deno.test("compute-invoice-balance: latest receivedAt wins when multiple payments close the invoice", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const { flow, invoices, payments } = fresh();
  const inv = await invoices.create("u-1", {
    contractId: "c-1", dueDate: "2026-05-01", amount: 100, status: "pending",
  });
  await payments.create("u-1", {
    invoiceId: inv.id, amount: 40, method: "cash", receivedAt: "2026-04-01T00:00:00.000Z",
  });
  await payments.create("u-1", {
    invoiceId: inv.id, amount: 60, method: "check", receivedAt: "2026-04-10T00:00:00.000Z",
  });

  await flow.run(inv.id, "u-1");
  const after = await invoices.getOwned(inv.id, "u-1");
  assertEquals(after.status, "paid");
  assertEquals(after.paidAt, "2026-04-10T00:00:00.000Z");
  await resetKv();
});
