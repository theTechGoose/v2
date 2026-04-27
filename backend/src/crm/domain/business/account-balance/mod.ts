import type { Entry } from "@crm/dto/entry.ts";

export interface AccountBalance {
  balance: number;
  charges: number;
  payments: number;
  entryCount: number;
}

export function balanceFromEntries(entries: Pick<Entry, "amount">[]): AccountBalance {
  let balance = 0;
  let charges = 0;
  let payments = 0;
  for (const e of entries) {
    balance += e.amount;
    if (e.amount < 0) charges += -e.amount;
    else if (e.amount > 0) payments += e.amount;
  }
  return { balance, charges, payments, entryCount: entries.length };
}
