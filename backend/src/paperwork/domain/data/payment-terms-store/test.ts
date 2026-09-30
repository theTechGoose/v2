import { assertEquals, assertRejects } from "#std/assert";
import { PaymentTermsStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { ForbiddenError } from "@core/data/repository/mod.ts";

Deno.test("payment-terms-store smoke: create with installments and round-trip per owner", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new PaymentTermsStore();
  const terms = await store.create("u-1", {
    name: "50/50 split",
    installments: [
      { percent: 50, dueDate: "2026-04-01", label: "Deposit" },
      { percent: 50, dueDate: "2026-05-01", label: "On completion" },
    ],
  });
  const fetched = await store.getOwned(terms.id, "u-1");
  assertEquals(fetched.name, "50/50 split");
  assertEquals(fetched.installments.length, 2);
  await resetKv();
});

Deno.test("payment-terms-store smoke: cross-user denied", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new PaymentTermsStore();
  const terms = await store.create("u-1", { name: "x", installments: [{ percent: 100, dueDate: "2026-04-01" }] });
  await assertRejects(() => store.getOwned(terms.id, "u-2"), ForbiddenError);
  await resetKv();
});
