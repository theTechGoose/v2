import type { Entry } from "@crm/dto/entry.ts";

export interface TransactionGroup {
  transactionId: string;
  entries: Pick<Entry, "amount" | "accountId">[];
  netAmount: number;
  isBalanced: boolean;
}

export function groupByTransaction(
  entries: Pick<Entry, "amount" | "accountId" | "transactionId">[],
): TransactionGroup[] {
  const buckets = new Map<string, Pick<Entry, "amount" | "accountId">[]>();
  for (const e of entries) {
    if (!e.transactionId) continue;
    const list = buckets.get(e.transactionId) ?? [];
    list.push({ amount: e.amount, accountId: e.accountId });
    buckets.set(e.transactionId, list);
  }
  return [...buckets.entries()].map(([transactionId, group]) => {
    const netAmount = group.reduce((s, e) => s + e.amount, 0);
    return { transactionId, entries: group, netAmount, isBalanced: netAmount === 0 };
  });
}

export function isTransactionBalanced(
  entries: Pick<Entry, "amount" | "transactionId">[],
  transactionId: string,
): boolean {
  const sum = entries
    .filter((e) => e.transactionId === transactionId)
    .reduce((s, e) => s + e.amount, 0);
  return sum === 0;
}
