import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import { NotFoundError } from "@core/data/repository/mod.ts";
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
    input: CreateChangeOrderDto & {
      quoteId?: string;
      customerId?: string;
      originalAmountCents?: number;
    },
  ): Promise<ChangeOrder> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const co: ChangeOrder = {
      id,
      userId,
      invoiceId,
      ...(input.quoteId ? { quoteId: input.quoteId } : {}),
      ...(input.customerId ? { customerId: input.customerId } : {}),
      description: input.description.trim(),
      deltaAmountCents: Math.round(input.deltaAmountCents),
      // Snapshot the pre-change invoice total so the public projection
      // doesn't double-apply the delta after approval mutates the invoice.
      ...(input.originalAmountCents != null
        ? { originalAmountCents: Math.round(input.originalAmountCents) }
        : {}),
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
    if (!r.value) throw new NotFoundError(PREFIX, id);
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

  /**
   * Contractor edit (owner-gated). Editing re-opens approval: the row resets
   * to `pending` and the prior `decidedAt` is cleared, so the customer must
   * approve the revised amount. `originalAmountCents` is re-snapshotted by the
   * caller (it knows the live invoice total after any revert). The delta is
   * NOT applied to the invoice here — that still happens on the customer's
   * public approval.
   */
  async update(
    id: string,
    userId: string,
    patch: {
      description: string;
      deltaAmountCents: number;
      originalAmountCents: number;
    },
  ): Promise<ChangeOrder> {
    const co = await this.getOwned(id, userId);
    // Drop decidedAt — the edit re-opens the decision.
    const { decidedAt: _cleared, ...rest } = co;
    const next: ChangeOrder = {
      ...rest,
      description: patch.description.trim(),
      deltaAmountCents: Math.round(patch.deltaAmountCents),
      originalAmountCents: Math.round(patch.originalAmountCents),
      status: "pending",
      updatedAt: new Date().toISOString(),
    };
    const kv = await getKv();
    await kv.set([PREFIX, id], next, { expireIn: TTL_MS });
    return next;
  }

  /** Owner-gated delete. The caller reverts any already-applied delta from
   *  the invoice first (an approved order mutated the live total). */
  async delete(id: string, userId: string): Promise<void> {
    await this.getOwned(id, userId);
    const kv = await getKv();
    await kv.delete([PREFIX, id]);
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
