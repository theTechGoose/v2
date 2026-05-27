import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import type {
  ChangeOrder,
  ChangeOrderStatus,
  CreateChangeOrderDto,
} from "@paperwork/dto/change-order.ts";

const PREFIX = "change_order"; // [PREFIX, id] → ChangeOrder
const TTL_MS = 180 * 24 * 60 * 60 * 1_000; // 180 days

/**
 * ChangeOrderStore — one record per proposed invoice adjustment, keyed by
 * id. Small per-invoice cardinality, so listByInvoice is a filtered scan.
 */
@Injectable()
export class ChangeOrderStore {
  async create(
    userId: string,
    invoiceId: string,
    input: CreateChangeOrderDto & { contractId?: string; customerId?: string },
  ): Promise<ChangeOrder> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const co: ChangeOrder = {
      id,
      userId,
      invoiceId,
      ...(input.contractId ? { contractId: input.contractId } : {}),
      ...(input.customerId ? { customerId: input.customerId } : {}),
      description: input.description.trim(),
      deltaAmountCents: Math.round(input.deltaAmountCents),
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };
    const kv = await getKv();
    await kv.set([PREFIX, id], co, { expireIn: TTL_MS });
    return co;
  }

  async get(id: string): Promise<ChangeOrder> {
    const kv = await getKv();
    const r = await kv.get<ChangeOrder>([PREFIX, id]);
    if (!r.value) throw new Error(`change order not found: ${id}`);
    return r.value;
  }

  async getOwned(id: string, userId: string): Promise<ChangeOrder> {
    const co = await this.get(id);
    if (co.userId !== userId) throw new Error("forbidden");
    return co;
  }

  async listByInvoice(
    userId: string,
    invoiceId: string,
  ): Promise<ChangeOrder[]> {
    const kv = await getKv();
    const out: ChangeOrder[] = [];
    const iter = kv.list<ChangeOrder>({ prefix: [PREFIX] });
    for await (const entry of iter) {
      const co = entry.value;
      if (co.userId === userId && co.invoiceId === invoiceId) out.push(co);
    }
    out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return out;
  }

  /** Public decision write — no userId (the link is the capability). */
  async setStatus(id: string, status: ChangeOrderStatus): Promise<ChangeOrder> {
    const co = await this.get(id);
    const next: ChangeOrder = {
      ...co,
      status,
      decidedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const kv = await getKv();
    await kv.set([PREFIX, id], next, { expireIn: TTL_MS });
    return next;
  }
}
