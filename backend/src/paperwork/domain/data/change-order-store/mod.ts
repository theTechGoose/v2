import { Injectable } from "#danet/core";
import { getKv, indexedIds, readMany } from "@core/data/kv/mod.ts";
import { ForbiddenError, NotFoundError } from "@core/data/repository/mod.ts";
import { DocNumbering } from "@core/data/doc-numbering/mod.ts";
import {
  createNumbered,
  type CreateNumberedOpts,
  listNumberedVersions,
  publishNumbered,
  snapshotCustomer,
} from "@core/data/numbered-store/mod.ts";
import type { DocVersionRecord } from "#documents/versions.ts";
import type {
  ChangeOrder,
  ChangeOrderStatus,
  CreateChangeOrderDto,
} from "@paperwork/dto/change-order.ts";

const PREFIX = "change_order"; // [PREFIX, id] → ChangeOrder
const INDEX_PREFIX = "change_order_by_user"; // [INDEX_PREFIX, userId, id] → id (REQ-202)

/**
 * ChangeOrderStore — one record per proposed invoice adjustment, keyed by
 * id, numbered CO-001… per account (REQ-198) and indexed per account.
 *
 * REQ-202: change orders are part of the agreement's record — they are
 * never expired (the 180-day TTL is gone) and an approved one is kept as
 * it was approved.
 */
@Injectable()
export class ChangeOrderStore {
  constructor(private numbering: DocNumbering = new DocNumbering()) {}

  async create(
    userId: string,
    invoiceId: string,
    input: CreateChangeOrderDto & {
      quoteId?: string;
      customerId?: string;
      originalAmountCents?: number;
    },
    opts: CreateNumberedOpts = {},
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
    const customerSnapshot = await snapshotCustomer(co.customerId, userId);
    if (customerSnapshot) co.customerSnapshot = customerSnapshot;
    return await createNumbered(this.numbering, {
      userId,
      kind: "changeOrder",
      prefix: PREFIX,
      indexPrefix: INDEX_PREFIX,
      record: co,
    }, opts);
  }

  async get(id: string): Promise<ChangeOrder> {
    const kv = await getKv();
    const r = await kv.get<ChangeOrder>([PREFIX, id]);
    if (!r.value) throw new NotFoundError(PREFIX, id);
    return r.value;
  }

  async getOwned(id: string, userId: string): Promise<ChangeOrder> {
    const co = await this.get(id);
    if (co.userId !== userId) throw new ForbiddenError(PREFIX, id);
    return co;
  }

  /** Every change order of the account (REQ-202: the per-account index; legacy rows without one are swept in). */
  async listByUser(userId: string): Promise<ChangeOrder[]> {
    const kv = await getKv();
    const ids = await indexedIds(kv, [INDEX_PREFIX, userId]);
    const indexed =
      (await readMany<ChangeOrder>(kv, ids.map((id) => [PREFIX, id])))
        .filter((c): c is ChangeOrder => !!c);
    const seen = new Set(indexed.map((c) => c.id));
    // Rows written before the index existed carry no index entry.
    for await (const entry of kv.list<ChangeOrder>({ prefix: [PREFIX] })) {
      const co = entry.value;
      if (co.userId === userId && !seen.has(co.id)) indexed.push(co);
    }
    return indexed.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async listByInvoice(
    userId: string,
    invoiceId: string,
  ): Promise<ChangeOrder[]> {
    return (await this.listByUser(userId)).filter((co) =>
      co.invoiceId === invoiceId
    );
  }

  async listByQuote(userId: string, quoteId: string): Promise<ChangeOrder[]> {
    return (await this.listByUser(userId)).filter((co) =>
      co.quoteId === quoteId
    );
  }

  /**
   * Contractor edit (owner-gated). Editing re-opens approval: the row resets
   * to `pending` and the prior `decidedAt` is cleared, so the customer must
   * approve the revised amount. `originalAmountCents` is re-snapshotted by the
   * caller (it knows the live invoice total after any revert). The delta is
   * NOT applied to the invoice here — that still happens on the customer's
   * public approval. REQ-201: the edit is a published revision of the order
   * (its link does not change; its version advances; the old one is filed).
   */
  async update(
    id: string,
    userId: string,
    patch: {
      description: string;
      deltaAmountCents: number;
      originalAmountCents: number;
    },
    by: DocVersionRecord["publishedBy"] = { userId },
  ): Promise<ChangeOrder> {
    await this.getOwned(id, userId);
    return await publishNumbered<ChangeOrder>({
      kind: "changeOrder",
      prefix: PREFIX,
      id,
      patch: {
        description: patch.description.trim(),
        deltaAmountCents: Math.round(patch.deltaAmountCents),
        originalAmountCents: Math.round(patch.originalAmountCents),
        status: "pending",
      },
      by,
      read: () => this.getOwned(id, userId),
      finish: (next) => {
        // Drop decidedAt — the edit re-opens the decision.
        const { decidedAt: _cleared, approvedName: _who, ...rest } = next;
        return rest as ChangeOrder;
      },
    });
  }

  async listVersions(id: string, userId: string): Promise<DocVersionRecord[]> {
    await this.getOwned(id, userId);
    return await listNumberedVersions("changeOrder", id);
  }

  /** Owner-gated delete of a never-approved order (the controller refuses approved ones). */
  async delete(id: string, userId: string): Promise<void> {
    const existing = await this.getOwned(id, userId);
    const kv = await getKv();
    await kv.atomic()
      .delete([PREFIX, id])
      .delete([INDEX_PREFIX, existing.userId, id])
      .commit();
  }

  /**
   * Public decision write — no userId (the link is the capability).
   * Compare-and-set: only a `pending` order can be decided, and two
   * concurrent decisions cannot both win (REQ-200). Returns null when the
   * order was no longer pending.
   */
  async decide(
    id: string,
    status: Exclude<ChangeOrderStatus, "pending">,
    extra: { approvedName?: string } = {},
  ): Promise<ChangeOrder | null> {
    const kv = await getKv();
    for (let attempt = 0; attempt < 20; attempt++) {
      const entry = await kv.get<ChangeOrder>([PREFIX, id]);
      if (!entry.value) throw new NotFoundError(PREFIX, id);
      if (entry.value.status !== "pending") return null;
      const now = new Date().toISOString();
      const next: ChangeOrder = {
        ...entry.value,
        status,
        decidedAt: now,
        updatedAt: now,
        ...(extra.approvedName ? { approvedName: extra.approvedName } : {}),
      };
      const result = await kv.atomic().check(entry).set([PREFIX, id], next)
        .commit();
      if (result.ok) return next;
    }
    throw new Error(`change order ${id}: decision kept losing the race`);
  }

  /** @deprecated REQ-200: use `decide` — kept for callers that do not care about the race. */
  async setStatus(id: string, status: ChangeOrderStatus): Promise<ChangeOrder> {
    if (status === "pending") {
      const co = await this.get(id);
      const now = new Date().toISOString();
      const next: ChangeOrder = { ...co, status, updatedAt: now };
      const kv = await getKv();
      await kv.set([PREFIX, id], next);
      return next;
    }
    const decided = await this.decide(id, status);
    return decided ?? await this.get(id);
  }
}
