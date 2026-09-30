import { assertEquals, assertRejects } from "#std/assert";
import { PaymentStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { ForbiddenError } from "@core/data/repository/mod.ts";
import type { CreatePaymentDto } from "@paperwork/dto/payment.ts";

const fixture = (overrides: Partial<CreatePaymentDto> = {}): CreatePaymentDto => ({
  invoiceId: "inv-1",
  amount: 100,
  method: "cash",
  receivedAt: "2026-04-15T00:00:00.000Z",
  ...overrides,
});

Deno.test("payment-store smoke: create + getOwned for owner", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new PaymentStore();
  const p = await store.create("u-1", fixture());
  const fetched = await store.getOwned(p.id, "u-1");
  assertEquals(fetched.invoiceId, "inv-1");
  assertEquals(fetched.amount, 100);
  await resetKv();
});

Deno.test("payment-store smoke: cross-user denied", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new PaymentStore();
  const p = await store.create("u-1", fixture());
  await assertRejects(() => store.getOwned(p.id, "u-2"), ForbiddenError);
  await resetKv();
});

Deno.test("payment-store smoke: listByInvoice scoped to invoice + user", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new PaymentStore();
  await store.create("u-1", fixture({ invoiceId: "inv-A", amount: 50 }));
  await store.create("u-1", fixture({ invoiceId: "inv-A", amount: 25 }));
  await store.create("u-1", fixture({ invoiceId: "inv-B", amount: 99 }));
  await store.create("u-2", fixture({ invoiceId: "inv-A", amount: 999 }));
  const u1A = await store.listByInvoice("inv-A", "u-1");
  assertEquals(u1A.length, 2);
  assertEquals(u1A.reduce((s, p) => s + p.amount, 0), 75);
  const u2A = await store.listByInvoice("inv-A", "u-2");
  assertEquals(u2A.length, 1);
  await resetKv();
});

Deno.test("payment-store smoke: listByUserAndMethod filters", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new PaymentStore();
  await store.create("u-1", fixture({ method: "cash" }));
  await store.create("u-1", fixture({ method: "check" }));
  await store.create("u-1", fixture({ method: "card" }));
  assertEquals((await store.listByUserAndMethod("u-1", "cash")).length, 1);
  assertEquals((await store.listByUserAndMethod("u-1", "check")).length, 1);
  await resetKv();
});

Deno.test("payment-store smoke: delete clears both indexes", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new PaymentStore();
  const p = await store.create("u-1", fixture());
  await store.delete(p.id, "u-1");
  assertEquals((await store.listByUser("u-1")).length, 0);
  assertEquals((await store.listByInvoice("inv-1", "u-1")).length, 0);
  await resetKv();
});
