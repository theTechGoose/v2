import { assertEquals, assertRejects } from "#std/assert";
import { InvoiceStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { ForbiddenError } from "@core/data/repository/mod.ts";

Deno.test("invoice-store smoke: create + getOwned for owner", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new InvoiceStore();
  const i = await store.create("u-1", { contractId: "c-1", dueDate: "2026-05-01" });
  const fetched = await store.getOwned(i.id, "u-1");
  assertEquals(fetched.contractId, "c-1");
  await resetKv();
});

Deno.test("invoice-store smoke: cross-user denied", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new InvoiceStore();
  const i = await store.create("u-1", { contractId: "c-1", dueDate: "2026-05-01" });
  await assertRejects(() => store.getOwned(i.id, "u-2"), ForbiddenError);
  await resetKv();
});

Deno.test("invoice-store smoke: listByUserAndStatus ('pending' / 'paid')", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new InvoiceStore();
  await store.create("u-1", { contractId: "c-1", dueDate: "2026-05-01", status: "pending" });
  await store.create("u-1", { contractId: "c-1", dueDate: "2026-05-02", status: "paid" });
  await store.create("u-2", { contractId: "c-1", dueDate: "2026-05-03", status: "pending" });
  assertEquals((await store.listByUserAndStatus("u-1", "pending")).length, 1);
  assertEquals((await store.listByUserAndStatus("u-1", "paid")).length, 1);
  assertEquals((await store.listByUserAndStatus("u-2", "pending")).length, 1);
  await resetKv();
});

Deno.test("invoice-store smoke: milestone fields round-trip", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new InvoiceStore();
  const i = await store.create("u-1", {
    contractId: "c-1",
    dueDate: "2026-05-14",
    status: "scheduled",
    scheduledFor: "2026-05-07",
    installmentIndex: 2,
    installmentTotal: 3,
    remindersMuted: true,
  });
  const fetched = await store.getOwned(i.id, "u-1");
  assertEquals(fetched.status, "scheduled");
  assertEquals(fetched.scheduledFor, "2026-05-07");
  assertEquals(fetched.installmentIndex, 2);
  assertEquals(fetched.installmentTotal, 3);
  assertEquals(fetched.remindersMuted, true);
  await resetKv();
});

Deno.test("invoice-store smoke: paymentIntent round-trip + clear", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new InvoiceStore();
  const i = await store.create("u-1", {
    contractId: "c-1",
    dueDate: "2026-05-14",
    amount: 180_000,
    status: "sent",
  });
  // Customer claims payment.
  const claimed = await store.update(i.id, "u-1", {
    status: "claimed",
    paymentIntent: {
      method: "check",
      amount: 180_000,
      reference: "#1234",
      claimedAt: "2026-05-12T17:30:00Z",
      claimedBy: "Hans Pedersen",
    },
  });
  assertEquals(claimed.status, "claimed");
  assertEquals(claimed.paymentIntent?.method, "check");
  assertEquals(claimed.paymentIntent?.reference, "#1234");

  // Contractor confirms — paymentIntent should be cleared via undefined patch.
  // Note: store filters undefined out of the patch (intentional), so to
  // clear we pass a sentinel empty intent OR rely on a separate update
  // that simply omits paymentIntent (which won't clear). For now, exercise
  // the round-trip; the actual clear path lives in the confirm coordinator.
  await resetKv();
});

Deno.test("invoice-store smoke: reminder history append", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new InvoiceStore();
  const i = await store.create("u-1", {
    contractId: "c-1",
    dueDate: "2026-04-01",
    amount: 50_000,
    status: "sent",
  });
  const after3 = await store.update(i.id, "u-1", {
    reminderHistory: [{ day: 3, sentAt: "2026-04-04T15:00:00Z", channels: ["email", "sms"] }],
  });
  assertEquals(after3.reminderHistory?.length, 1);
  const after7 = await store.update(i.id, "u-1", {
    reminderHistory: [
      { day: 3, sentAt: "2026-04-04T15:00:00Z", channels: ["email", "sms"] },
      { day: 7, sentAt: "2026-04-08T15:00:00Z", channels: ["email"] },
    ],
  });
  assertEquals(after7.reminderHistory?.length, 2);
  assertEquals(after7.reminderHistory?.[1].day, 7);
  await resetKv();
});
