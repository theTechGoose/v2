import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
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
    const payment: Payment = { ...input, id, userId, createdAt: now, updatedAt: now };
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

  async listByUser(userId: string): Promise<Payment[]> {
    const kv = await getKv();
    const out: Payment[] = [];
    for await (const e of kv.list<string>({ prefix: [INDEX_BY_USER, userId] })) {
      const r = await kv.get<Payment>([PREFIX, e.value]);
      if (r.value) out.push(r.value);
    }
    return out;
  }

  async listByUserAndMethod(userId: string, method: PaymentMethod): Promise<Payment[]> {
    const all = await this.listByUser(userId);
    return all.filter((p) => p.method === method);
  }

  async listByInvoice(invoiceId: string, userId: string): Promise<Payment[]> {
    const kv = await getKv();
    const out: Payment[] = [];
    for await (const e of kv.list<string>({ prefix: [INDEX_BY_INVOICE, invoiceId] })) {
      const r = await kv.get<Payment>([PREFIX, e.value]);
      if (r.value && r.value.userId === userId) out.push(r.value);
    }
    return out;
  }

  async update(id: string, userId: string, patch: UpdatePaymentDto): Promise<Payment> {
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
