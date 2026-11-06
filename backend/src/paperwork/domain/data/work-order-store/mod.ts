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
  CreateWorkOrderDto,
  UpdateWorkOrderDto,
  WorkOrder,
} from "@paperwork/dto/work-order.ts";

const PREFIX = "work_order"; // [PREFIX, id] → WorkOrder
const INDEX_PREFIX = "work_order_by_user"; // [INDEX_PREFIX, userId, id] → id

/** Drop undefined / empty-string optionals so a record never stores blanks. */
function clean<T extends object>(o: T): T {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined && v !== ""),
  ) as T;
}

/**
 * WorkOrderStore — REQ-210: one numbered WO- record per job order, per
 * account (REQ-198), indexed per account, revised as published versions
 * (REQ-201: the old version is filed with who/when; the number stays).
 */
@Injectable()
export class WorkOrderStore {
  constructor(private numbering: DocNumbering = new DocNumbering()) {}

  async create(
    userId: string,
    input: CreateWorkOrderDto,
    opts: CreateNumberedOpts = {},
  ): Promise<WorkOrder> {
    const now = new Date().toISOString();
    const wo: WorkOrder = clean({
      id: crypto.randomUUID(),
      userId,
      customerId: input.customerId,
      quoteId: input.quoteId,
      invoiceId: input.invoiceId,
      description: input.description.trim(),
      serviceAddress: input.serviceAddress?.trim(),
      scheduledFor: input.scheduledFor,
      completedOn: input.completedOn,
      assignee: input.assignee?.trim(),
      notes: input.notes,
      status: input.status ?? "open",
      createdAt: now,
      updatedAt: now,
    });
    const customerSnapshot = await snapshotCustomer(wo.customerId, userId);
    if (customerSnapshot) wo.customerSnapshot = customerSnapshot;
    return await createNumbered(this.numbering, {
      userId,
      kind: "workOrder",
      prefix: PREFIX,
      indexPrefix: INDEX_PREFIX,
      record: wo,
    }, opts);
  }

  async get(id: string): Promise<WorkOrder> {
    const kv = await getKv();
    const r = await kv.get<WorkOrder>([PREFIX, id]);
    if (!r.value) throw new NotFoundError(PREFIX, id);
    return r.value;
  }

  async getOwned(id: string, userId: string): Promise<WorkOrder> {
    const wo = await this.get(id);
    if (wo.userId !== userId) throw new ForbiddenError(PREFIX, id);
    return wo;
  }

  async listByUser(userId: string): Promise<WorkOrder[]> {
    const kv = await getKv();
    const ids = await indexedIds(kv, [INDEX_PREFIX, userId]);
    const rows = (await readMany<WorkOrder>(kv, ids.map((id) => [PREFIX, id])))
      .filter((w): w is WorkOrder => !!w);
    return rows.sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0));
  }

  async listByQuote(userId: string, quoteId: string): Promise<WorkOrder[]> {
    return (await this.listByUser(userId)).filter((w) => w.quoteId === quoteId);
  }

  /** REQ-201: an edit is the next version on the same number; the previous one is filed. */
  async update(
    id: string,
    userId: string,
    patch: UpdateWorkOrderDto,
    by: DocVersionRecord["publishedBy"] = { userId },
  ): Promise<WorkOrder> {
    await this.getOwned(id, userId);
    const content = clean({
      ...patch,
      ...(patch.description !== undefined
        ? { description: patch.description.trim() }
        : {}),
      ...(patch.assignee !== undefined
        ? { assignee: patch.assignee.trim() }
        : {}),
      ...(patch.serviceAddress !== undefined
        ? { serviceAddress: patch.serviceAddress.trim() }
        : {}),
    });
    return await publishNumbered<WorkOrder>({
      kind: "workOrder",
      prefix: PREFIX,
      id,
      patch: content,
      by,
      read: () => this.getOwned(id, userId),
    });
  }

  async listVersions(id: string, userId: string): Promise<DocVersionRecord[]> {
    await this.getOwned(id, userId);
    return await listNumberedVersions("workOrder", id);
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
