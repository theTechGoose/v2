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
  CreateInvoiceDto,
  Invoice,
  UpdateInvoiceDto,
} from "@paperwork/dto/invoice.ts";

const PREFIX = "invoice";
const INDEX_PREFIX = "invoice_by_user";

@Injectable()
export class InvoiceStore {
  constructor(private numbering: DocNumbering = new DocNumbering()) {}

  async create(
    userId: string,
    input: CreateInvoiceDto,
    opts: CreateNumberedOpts = {},
  ): Promise<Invoice> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    // Stored rows always carry a dueDate (the controller defaults it; this
    // is the type-level backstop for direct store callers).
    const inv: Invoice = {
      ...input,
      dueDate: input.dueDate ??
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(
          0,
          10,
        ),
      id,
      userId,
      createdAt: now,
      updatedAt: now,
    };
    // REQ-204: the customer as they are today travels with the document.
    const customerSnapshot = await snapshotCustomer(inv.customerId, userId);
    if (customerSnapshot) inv.customerSnapshot = customerSnapshot;
    // REQ-198/200: the next INV- number, in the same transaction as the row.
    return await createNumbered(this.numbering, {
      userId,
      kind: "invoice",
      prefix: PREFIX,
      indexPrefix: INDEX_PREFIX,
      record: inv,
    }, opts);
  }

  /** REQ-201: an edit to an issued invoice waits here until published. */
  async setPending(
    id: string,
    userId: string,
    patch: Record<string, unknown>,
  ): Promise<Invoice> {
    const existing = await this.getOwned(id, userId);
    const defined = Object.fromEntries(
      Object.entries(patch).filter(([_, v]) => v !== undefined),
    );
    const updated: Invoice = {
      ...existing,
      pendingRevision: { ...(existing.pendingRevision ?? {}), ...defined },
      updatedAt: new Date().toISOString(),
    };
    const kv = await getKv();
    await kv.set([PREFIX, id], updated);
    return updated;
  }

  async clearPending(id: string, userId: string): Promise<Invoice> {
    const existing = await this.getOwned(id, userId);
    const { pendingRevision: _p, ...rest } = existing;
    const updated: Invoice = { ...rest, updatedAt: new Date().toISOString() };
    const kv = await getKv();
    await kv.set([PREFIX, id], updated);
    return updated;
  }

  /** REQ-201: publish a revision — same number, same link, next version; the replaced version is filed. */
  async publishRevision(
    id: string,
    userId: string,
    patch: Record<string, unknown>,
    by: DocVersionRecord["publishedBy"],
    finish?: (next: Invoice) => Invoice | Promise<Invoice>,
  ): Promise<Invoice> {
    return await publishNumbered<Invoice>({
      kind: "invoice",
      prefix: PREFIX,
      id,
      patch,
      by,
      read: () => this.getOwned(id, userId),
      finish,
    });
  }

  async listVersions(id: string, userId: string): Promise<DocVersionRecord[]> {
    await this.getOwned(id, userId);
    return await listNumberedVersions("invoice", id);
  }

  /** REQ-200: compare-and-set patch while `predicate` holds; null when it does not. */
  async updateIf(
    id: string,
    predicate: (current: Invoice) => boolean,
    patch: UpdateInvoiceDto,
  ): Promise<Invoice | null> {
    const kv = await getKv();
    for (let attempt = 0; attempt < 20; attempt++) {
      const entry = await kv.get<Invoice>([PREFIX, id]);
      if (!entry.value) throw new NotFoundError(PREFIX, id);
      if (!predicate(entry.value)) return null;
      const definedPatch = Object.fromEntries(
        Object.entries(patch).filter(([_, v]) => v !== undefined),
      );
      const updated: Invoice = {
        ...entry.value,
        ...definedPatch,
        id: entry.value.id,
        userId: entry.value.userId,
        createdAt: entry.value.createdAt,
        updatedAt: new Date().toISOString(),
      };
      for (const [k, v] of Object.entries(definedPatch)) {
        if (v === null) {
          delete (updated as unknown as Record<string, unknown>)[k];
        }
      }
      const result = await kv.atomic().check(entry).set([PREFIX, id], updated)
        .commit();
      if (result.ok) return updated;
    }
    throw new Error(`invoice ${id}: conditional update kept losing the race`);
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
    const ids = await indexedIds(kv, [INDEX_PREFIX, userId]); // REQ-134 — read in batches
    const recs = await readMany<Invoice>(kv, ids.map((id) => [PREFIX, id]));
    return recs.filter((i): i is Invoice => !!i);
  }

  async listByUserAndStatus(
    userId: string,
    status: string,
  ): Promise<Invoice[]> {
    const all = await this.listByUser(userId);
    return all.filter((i) => i.status === status);
  }

  async update(
    id: string,
    userId: string,
    patch: UpdateInvoiceDto,
  ): Promise<Invoice> {
    const existing = await this.getOwned(id, userId);
    // `undefined` → leave the field untouched. `null` → explicitly clear it
    // (e.g. reject-claim wiping paymentIntent so a rejected claim can't later
    // be confirmed into a bogus payment).
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
    for (const [k, v] of Object.entries(definedPatch)) {
      if (v === null) delete (updated as unknown as Record<string, unknown>)[k];
    }
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
