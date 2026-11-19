/**
 * REQ-1088 (LOOP-007 cycle 3, q3-6): "Invoice service address not tidied".
 * QA3 typed "4410 avenue h, austin tx 78751" into the New invoice form; the
 * store spread the input and kept it raw, so /i and the invoice email printed
 * it lowercase. A stored invoice serviceAddress is tidy, whoever wrote it.
 */
import { assertEquals } from "#std/assert";
import { InvoiceStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

Deno.test("REQ-1088 q3-6 invoice-store: create stores a lowercase serviceAddress tidy ('4410 Avenue H, Austin, TX 78751')", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    const store = new InvoiceStore();
    const inv = await store.create("u-1", {
      dueDate: "2026-12-01",
      serviceAddress: "4410 avenue h, austin tx 78751",
    });
    assertEquals(
      (await store.getOwned(inv.id, "u-1")).serviceAddress,
      "4410 Avenue H, Austin, TX 78751",
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-1088 q3-6 invoice-store: update stores a lowercase serviceAddress tidy", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    const store = new InvoiceStore();
    const inv = await store.create("u-1", { dueDate: "2026-12-01" });
    await store.update(inv.id, "u-1", {
      serviceAddress: "45 palmetto dr, conway, SC 29526",
    });
    assertEquals(
      (await store.getOwned(inv.id, "u-1")).serviceAddress,
      "45 Palmetto Dr, Conway, SC 29526",
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-1088 invoice-store: a formatted serviceAddress is stored unchanged", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  try {
    const store = new InvoiceStore();
    const inv = await store.create("u-1", {
      dueDate: "2026-12-01",
      serviceAddress: "12 Oak St, Austin, TX 78701",
    });
    assertEquals(
      (await store.getOwned(inv.id, "u-1")).serviceAddress,
      "12 Oak St, Austin, TX 78701",
    );
  } finally {
    await resetKv();
  }
});
