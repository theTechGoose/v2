import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import { ForbiddenError, NotFoundError } from "@core/data/repository/mod.ts";
import type {
  Contract,
  CreateContractDto,
  UpdateContractDto,
} from "@paperwork/dto/contract.ts";

const PREFIX = "contract";
const INDEX_PREFIX = "contract_by_user";

@Injectable()
export class ContractStore {
  async create(userId: string, input: CreateContractDto): Promise<Contract> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const c: Contract = { ...input, id, userId, createdAt: now, updatedAt: now };
    const kv = await getKv();
    await kv.atomic()
      .set([PREFIX, id], c)
      .set([INDEX_PREFIX, userId, id], id)
      .commit();
    return c;
  }

  async get(id: string): Promise<Contract> {
    const kv = await getKv();
    const r = await kv.get<Contract>([PREFIX, id]);
    if (!r.value) throw new NotFoundError(PREFIX, id);
    return r.value;
  }

  async getOwned(id: string, userId: string): Promise<Contract> {
    const c = await this.get(id);
    if (c.userId !== userId) throw new ForbiddenError(PREFIX, id);
    return c;
  }

  async listByUser(userId: string): Promise<Contract[]> {
    const kv = await getKv();
    const out: Contract[] = [];
    for await (const e of kv.list<string>({ prefix: [INDEX_PREFIX, userId] })) {
      const r = await kv.get<Contract>([PREFIX, e.value]);
      if (r.value) out.push(r.value);
    }
    return out;
  }

  async listByUserAndStatus(userId: string, status: string): Promise<Contract[]> {
    const all = await this.listByUser(userId);
    return all.filter((c) => c.status === status);
  }

  async update(id: string, userId: string, patch: UpdateContractDto): Promise<Contract> {
    const existing = await this.getOwned(id, userId);
    const definedPatch = Object.fromEntries(
      Object.entries(patch).filter(([_, v]) => v !== undefined),
    );
    const updated: Contract = {
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
