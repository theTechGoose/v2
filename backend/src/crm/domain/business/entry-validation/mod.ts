import type { Entry } from "@crm/dto/entry.ts";

export function isPostable(e: Pick<Entry, "amount" | "accountId" | "occurredAt">): boolean {
  if (!e.accountId || e.accountId.length === 0) return false;
  if (!e.occurredAt || Number.isNaN(new Date(e.occurredAt).getTime())) return false;
  if (!Number.isFinite(e.amount) || e.amount === 0) return false;
  return true;
}

export function direction(e: Pick<Entry, "amount">): "debit" | "credit" | "zero" {
  if (e.amount > 0) return "debit";
  if (e.amount < 0) return "credit";
  return "zero";
}
