import { Injectable } from "#danet/core";
import { AccountStore } from "@crm/domain/data/account-store/mod.ts";
import { EntryStore } from "@crm/domain/data/entry-store/mod.ts";
import {
  type AccountBalance,
  balanceFromEntries,
} from "@crm/domain/business/account-balance/mod.ts";
import type { Account } from "@crm/dto/account.ts";

export interface AccountStanding {
  account: Account;
  balance: AccountBalance;
}

@Injectable()
export class ComputeAccountBalance {
  constructor(
    private accounts: AccountStore,
    private entries: EntryStore,
  ) {}

  async run(accountId: string): Promise<AccountStanding> {
    const account = await this.accounts.get(accountId);
    // Entries are user-scoped; fetch via account.userId so the balance
    // reflects only the rightful owner's entries (defense-in-depth).
    const entries = await this.entries.listByAccount(account.userId, accountId);
    const balance = balanceFromEntries(entries);
    return { account, balance };
  }
}
