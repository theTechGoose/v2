import { assertEquals } from "#std/assert";
import { ComputeAccountBalance } from "./mod.ts";
import { AccountStore } from "@crm/domain/data/account-store/mod.ts";
import { EntryStore } from "@crm/domain/data/entry-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";

const USER = "u-1";

Deno.test("compute-account-balance integration: charge then payment settles the account", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const accounts = new AccountStore();
  const entries  = new EntryStore();
  const flow     = new ComputeAccountBalance(accounts, entries);

  const acme = await accounts.create(USER, { name: "Acme — ledger", customerId: "cust-1" });
  await entries.create(USER, { accountId: acme.id, amount: -1280, occurredAt: "2026-04-26", description: "water heater job" });

  const afterCharge = await flow.run(acme.id);
  assertEquals(afterCharge.balance.balance, -1280);
  assertEquals(afterCharge.balance.charges, 1280);
  assertEquals(afterCharge.balance.payments, 0);

  await entries.create(USER, { accountId: acme.id, amount: 1280, occurredAt: "2026-04-30", description: "ACH payment" });

  const afterPayment = await flow.run(acme.id);
  assertEquals(afterPayment.balance.balance, 0);
  assertEquals(afterPayment.balance.charges, 1280);
  assertEquals(afterPayment.balance.payments, 1280);
  assertEquals(afterPayment.balance.entryCount, 2);

  await resetKv();
});

Deno.test("compute-account-balance integration: outstanding charges leave a negative balance", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const accounts = new AccountStore();
  const entries  = new EntryStore();
  const flow     = new ComputeAccountBalance(accounts, entries);

  const acct = await accounts.create(USER, { name: "Beta — ledger", customerId: "cust-2" });
  await entries.create(USER, { accountId: acct.id, amount: -500, occurredAt: "2026-04-26" });
  await entries.create(USER, { accountId: acct.id, amount:  200, occurredAt: "2026-04-27" });

  const standing = await flow.run(acct.id);
  assertEquals(standing.balance.balance, -300);
  assertEquals(standing.balance.charges, 500);
  assertEquals(standing.balance.payments, 200);

  await resetKv();
});

Deno.test("compute-account-balance integration: another user's entries do NOT contaminate the balance", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const accounts = new AccountStore();
  const entries  = new EntryStore();
  const flow     = new ComputeAccountBalance(accounts, entries);

  const a = await accounts.create("u-1", { name: "User-1 ledger" });
  // Both users happen to use the same accountId string for an entry — store isolation prevents cross-pollination.
  await entries.create("u-1", { accountId: a.id, amount: -100, occurredAt: "2026-04-26" });
  await entries.create("u-2", { accountId: a.id, amount: -999, occurredAt: "2026-04-26" });

  const standing = await flow.run(a.id);
  assertEquals(standing.balance.balance, -100);                // u-2's entry is invisible
  assertEquals(standing.balance.entryCount, 1);
  await resetKv();
});
