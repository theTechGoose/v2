import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import { ForbiddenError, NotFoundError } from "@core/data/repository/mod.ts";
import type {
  CreateEntryDto,
  Entry,
  UpdateEntryDto,
} from "@crm/dto/entry.ts";

const PREFIX = "entry";
const INDEX_PREFIX = "entry_by_user";

@Injectable()
export class EntryStore {
  async create(userId: string, input: CreateEntryDto): Promise<Entry> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const entry: Entry = { ...input, id, userId, createdAt: now, updatedAt: now };
    const kv = await getKv();
    await kv.atomic()
      .set([PREFIX, id], entry)
      .set([INDEX_PREFIX, userId, id], id)
      .commit();
    return entry;
  }

  async get(id: string): Promise<Entry> {
    const kv = await getKv();
    const r = await kv.get<Entry>([PREFIX, id]);
    if (!r.value) throw new NotFoundError(PREFIX, id);
    return r.value;
  }

  async getOwned(id: string, userId: string): Promise<Entry> {
    const e = await this.get(id);
    if (e.userId !== userId) throw new ForbiddenError(PREFIX, id);
    return e;
  }

  async listByUser(userId: string): Promise<Entry[]> {
    const kv = await getKv();
    const out: Entry[] = [];
    for await (const indexEntry of kv.list<string>({ prefix: [INDEX_PREFIX, userId] })) {
      const r = await kv.get<Entry>([PREFIX, indexEntry.value]);
      if (r.value) out.push(r.value);
    }
    return out;
  }

  async listByAccount(userId: string, accountId: string): Promise<Entry[]> {
    const all = await this.listByUser(userId);
    return all.filter((e) => e.accountId === accountId);
  }

  async listByTransaction(userId: string, transactionId: string): Promise<Entry[]> {
    const all = await this.listByUser(userId);
    return all.filter((e) => e.transactionId === transactionId);
  }

  async update(id: string, userId: string, patch: UpdateEntryDto): Promise<Entry> {
    const existing = await this.getOwned(id, userId);
    const definedPatch = Object.fromEntries(
      Object.entries(patch).filter(([_, v]) => v !== undefined),
    );
    const updated: Entry = {
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
