import { Injectable } from "#danet/core";
import { getKv, indexedIds, readMany } from "@core/data/kv/mod.ts";
import { ForbiddenError, NotFoundError } from "@core/data/repository/mod.ts";
import type {
  CreatePaymentDto,
  Payment,
  PaymentMethod,
  UpdatePaymentDto,
} from "@paperwork/dto/payment.ts";

const PREFIX = "payment";
const INDEX_BY_USER = "payment_by_user";
const INDEX_BY_INVOICE = "payment_by_invoice";

@Injectable()
export class PaymentStore {
  async create(userId: string, input: CreatePaymentDto): Promise<Payment> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const payment: Payment = {
      ...input,
      id,
      userId,
      createdAt: now,
      updatedAt: now,
    };
    const kv = await getKv();
    await kv.atomic()
      .set([PREFIX, id], payment)
      .set([INDEX_BY_USER, userId, id], id)
      .set([INDEX_BY_INVOICE, input.invoiceId, id], id)
      .commit();
    return payment;
  }

  async get(id: string): Promise<Payment> {
    const kv = await getKv();
    const r = await kv.get<Payment>([PREFIX, id]);
    if (!r.value) throw new NotFoundError(PREFIX, id);
    return r.value;
  }

  async getOwned(id: string, userId: string): Promise<Payment> {
    const p = await this.get(id);
    if (p.userId !== userId) throw new ForbiddenError(PREFIX, id);
    return p;
  }

  /** REQ-926: money received — a charged-back payment is not in it. */
  async listByUser(userId: string): Promise<Payment[]> {
    return (await this.listByUserAll(userId)).filter((p) => !p.reversedAt);
  }

  /** REQ-926: every payment, charged back ones too (the /payments page). */
  async listByUserAll(userId: string): Promise<Payment[]> {
    const kv = await getKv();
    const ids = await indexedIds(kv, [INDEX_BY_USER, userId]); // REQ-134 — read in batches
    const recs = await readMany<Payment>(kv, ids.map((id) => [PREFIX, id]));
    return recs.filter((p): p is Payment => !!p);
  }

  async listByUserAndMethod(
    userId: string,
    method: PaymentMethod,
  ): Promise<Payment[]> {
    const all = await this.listByUser(userId);
    return all.filter((p) => p.method === method);
  }

  /** REQ-926: what pays the invoice — a charged-back payment does not. */
  async listByInvoice(invoiceId: string, userId: string): Promise<Payment[]> {
    return (await this.listByInvoiceAll(invoiceId, userId)).filter((p) =>
      !p.reversedAt
    );
  }

  async listByInvoiceAll(
    invoiceId: string,
    userId: string,
  ): Promise<Payment[]> {
    const kv = await getKv();
    const ids = await indexedIds(kv, [INDEX_BY_INVOICE, invoiceId]); // REQ-134 — read in batches
    const recs = await readMany<Payment>(kv, ids.map((id) => [PREFIX, id]));
    return recs.filter((p): p is Payment => !!p && p.userId === userId);
  }

  async update(
    id: string,
    userId: string,
    patch: UpdatePaymentDto,
  ): Promise<Payment> {
    const existing = await this.getOwned(id, userId);
    const definedPatch = Object.fromEntries(
      Object.entries(patch).filter(([_, v]) => v !== undefined),
    );
    const updated: Payment = {
      ...existing,
      ...definedPatch,
      id: existing.id,
      userId: existing.userId,
      invoiceId: existing.invoiceId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    const kv = await getKv();
    await kv.set([PREFIX, id], updated);
    return updated;
  }

  /** REQ-926: stamp (or, with null, clear) the chargeback. */
  async setReversal(
    id: string,
    userId: string,
    r: { reason?: string; feeCents: number } | null,
  ): Promise<Payment> {
    const existing = await this.getOwned(id, userId);
    const {
      reversedAt: _a,
      reversedReason: _r,
      reversedFeeCents: _f,
      ...rest
    } = existing;
    const now = new Date().toISOString();
    const updated: Payment = r
      ? {
        ...rest,
        reversedAt: now,
        ...(r.reason ? { reversedReason: r.reason } : {}),
        reversedFeeCents: r.feeCents,
        updatedAt: now,
      }
      : { ...rest, updatedAt: now };
    const kv = await getKv();
    await kv.set([PREFIX, id], updated);
    return updated;
  }

  async delete(id: string, userId: string): Promise<void> {
    const existing = await this.getOwned(id, userId);
    const kv = await getKv();
    await kv.atomic()
      .delete([PREFIX, id])
      .delete([INDEX_BY_USER, existing.userId, id])
      .delete([INDEX_BY_INVOICE, existing.invoiceId, id])
      .commit();
  }
}
