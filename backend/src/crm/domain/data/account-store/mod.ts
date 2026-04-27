import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import { ForbiddenError, NotFoundError } from "@core/data/repository/mod.ts";
import type {
  Account,
  CreateAccountDto,
  UpdateAccountDto,
} from "@crm/dto/account.ts";

const PREFIX = "account";
const INDEX_PREFIX = "account_by_user";

@Injectable()
export class AccountStore {
  async create(userId: string, input: CreateAccountDto): Promise<Account> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const account: Account = { ...input, id, userId, createdAt: now, updatedAt: now };
    const kv = await getKv();
    await kv.atomic()
      .set([PREFIX, id], account)
      .set([INDEX_PREFIX, userId, id], id)
      .commit();
    return account;
  }

  async get(id: string): Promise<Account> {
    const kv = await getKv();
    const r = await kv.get<Account>([PREFIX, id]);
    if (!r.value) throw new NotFoundError(PREFIX, id);
    return r.value;
  }

  async getOwned(id: string, userId: string): Promise<Account> {
    const a = await this.get(id);
    if (a.userId !== userId) throw new ForbiddenError(PREFIX, id);
    return a;
  }

  async listByUser(userId: string): Promise<Account[]> {
    const kv = await getKv();
    const out: Account[] = [];
    for await (const entry of kv.list<string>({ prefix: [INDEX_PREFIX, userId] })) {
      const r = await kv.get<Account>([PREFIX, entry.value]);
      if (r.value) out.push(r.value);
    }
    return out;
  }

  async listByCustomer(userId: string, customerId: string): Promise<Account[]> {
    const all = await this.listByUser(userId);
    return all.filter((a) => a.customerId === customerId);
  }

  async update(id: string, userId: string, patch: UpdateAccountDto): Promise<Account> {
    const existing = await this.getOwned(id, userId);
    const definedPatch = Object.fromEntries(
      Object.entries(patch).filter(([_, v]) => v !== undefined),
    );
    const updated: Account = {
      ...existing,
      ...definedPatch,
      id: existing.id,
      userId: existing.userId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    const kv = await getKv();
    await kv.set([PREFIX, id], updated);
    return updated;
  }

  async delete(id: string, userId: string): Promise<void> {
    const existing = await this.getOwned(id, userId);
    const kv = await getKv();
    await kv.atomic()
      .delete([PREFIX, id])
      .delete([INDEX_PREFIX, existing.userId, id])
      .commit();
  }
}
