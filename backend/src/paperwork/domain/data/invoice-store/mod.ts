import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import { ForbiddenError, NotFoundError } from "@core/data/repository/mod.ts";
import type {
  CreateInvoiceDto,
  Invoice,
  UpdateInvoiceDto,
} from "@paperwork/dto/invoice.ts";

const PREFIX = "invoice";
const INDEX_PREFIX = "invoice_by_user";

@Injectable()
export class InvoiceStore {
  async create(userId: string, input: CreateInvoiceDto): Promise<Invoice> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const inv: Invoice = { ...input, id, userId, createdAt: now, updatedAt: now };
    const kv = await getKv();
    await kv.atomic()
      .set([PREFIX, id], inv)
      .set([INDEX_PREFIX, userId, id], id)
      .commit();
    return inv;
  }

  async get(id: string): Promise<Invoice> {
    const kv = await getKv();
    const r = await kv.get<Invoice>([PREFIX, id]);
    if (!r.value) throw new NotFoundError(PREFIX, id);
    return r.value;
  }

  async getOwned(id: string, userId: string): Promise<Invoice> {
    const i = await this.get(id);
    if (i.userId !== userId) throw new ForbiddenError(PREFIX, id);
    return i;
  }

  async listByUser(userId: string): Promise<Invoice[]> {
    const kv = await getKv();
    const out: Invoice[] = [];
    for await (const e of kv.list<string>({ prefix: [INDEX_PREFIX, userId] })) {
      const r = await kv.get<Invoice>([PREFIX, e.value]);
      if (r.value) out.push(r.value);
    }
    return out;
  }

  async listByUserAndStatus(userId: string, status: string): Promise<Invoice[]> {
    const all = await this.listByUser(userId);
    return all.filter((i) => i.status === status);
  }

  async update(id: string, userId: string, patch: UpdateInvoiceDto): Promise<Invoice> {
    const existing = await this.getOwned(id, userId);
    const definedPatch = Object.fromEntries(
      Object.entries(patch).filter(([_, v]) => v !== undefined),
    );
    const updated: Invoice = {
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
