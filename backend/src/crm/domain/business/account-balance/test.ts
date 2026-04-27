import { assertEquals } from "#std/assert";
import { balanceFromEntries } from "./mod.ts";

Deno.test("balanceFromEntries: empty list is zero", () => {
  const b = balanceFromEntries([]);
  assertEquals(b.balance, 0);
  assertEquals(b.charges, 0);
  assertEquals(b.payments, 0);
  assertEquals(b.entryCount, 0);
});

Deno.test("balanceFromEntries: charge then payment cancels to zero", () => {
  const b = balanceFromEntries([{ amount: -1280 }, { amount: 1280 }]);
  assertEquals(b.balance, 0);
  assertEquals(b.charges, 1280);
  assertEquals(b.payments, 1280);
  assertEquals(b.entryCount, 2);
});

Deno.test("balanceFromEntries: outstanding charge leaves negative balance", () => {
  const b = balanceFromEntries([{ amount: -500 }, { amount: -200 }, { amount: 100 }]);
  assertEquals(b.balance, -600);
  assertEquals(b.charges, 700);
  assertEquals(b.payments, 100);
});

Deno.test("balanceFromEntries: overpaid customer sits on positive credit", () => {
  const b = balanceFromEntries([{ amount: -500 }, { amount: 800 }]);
  assertEquals(b.balance, 300);
  assertEquals(b.charges, 500);
  assertEquals(b.payments, 800);
});

Deno.test("balanceFromEntries: zero-amount entries count toward entryCount but not charges/payments", () => {
  // Zero is neither a charge nor a payment per the source's strict
  // < 0 / > 0 split. Ledger correction notes that net to zero (and the
  // `Entry` shape allows them) must not inflate either bucket.
  const b = balanceFromEntries([{ amount: -500 }, { amount: 0 }, { amount: 500 }]);
  assertEquals(b.balance, 0);
  assertEquals(b.charges, 500);
  assertEquals(b.payments, 500);
  assertEquals(b.entryCount, 3);
});

Deno.test("balanceFromEntries: only zero-amount entries produce zero balance with non-zero count", () => {
  const b = balanceFromEntries([{ amount: 0 }, { amount: 0 }]);
  assertEquals(b.balance, 0);
  assertEquals(b.charges, 0);
  assertEquals(b.payments, 0);
  assertEquals(b.entryCount, 2);
});
