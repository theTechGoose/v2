import type { Entry } from "@crm/dto/entry.ts";

export type EntryDirection = "charge" | "payment" | "noop";

export function entryDirection(e: Pick<Entry, "amount">): EntryDirection {
  if (e.amount < 0) return "charge";
  if (e.amount > 0) return "payment";
  return "noop";
}

export function isOutstanding(balance: number): boolean {
  return balance < 0;
}

export function isSettled(balance: number): boolean {
  return balance === 0;
}

export function hasCredit(balance: number): boolean {
  return balance > 0;
}
