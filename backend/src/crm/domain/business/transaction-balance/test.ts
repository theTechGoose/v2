import { assertEquals } from "#std/assert";
import { groupByTransaction, isTransactionBalanced } from "./mod.ts";

Deno.test("groupByTransaction: ignores entries without transactionId", () => {
  const groups = groupByTransaction([
    { accountId: "a", amount: 100 },
    { accountId: "b", amount: -100, transactionId: "t1" },
  ]);
  assertEquals(groups.length, 1);
  assertEquals(groups[0].transactionId, "t1");
});

Deno.test("groupByTransaction: paired entries net to 0 and report balanced", () => {
  const groups = groupByTransaction([
    { accountId: "cash", amount: 1000, transactionId: "t1" },
    { accountId: "ar", amount: -1000, transactionId: "t1" },
  ]);
  assertEquals(groups[0].netAmount, 0);
  assertEquals(groups[0].isBalanced, true);
});

Deno.test("groupByTransaction: unbalanced sums are flagged", () => {
  const groups = groupByTransaction([
    { accountId: "cash", amount: 1000, transactionId: "t1" },
    { accountId: "ar", amount: -800, transactionId: "t1" },
  ]);
  assertEquals(groups[0].netAmount, 200);
  assertEquals(groups[0].isBalanced, false);
});

Deno.test("isTransactionBalanced: scoped to the given transaction", () => {
  const all = [
    { amount: 100, transactionId: "t1" },
    { amount: -100, transactionId: "t1" },
    { amount: 50, transactionId: "t2" },
  ];
  assertEquals(isTransactionBalanced(all, "t1"), true);
  assertEquals(isTransactionBalanced(all, "t2"), false);
});
