import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import { ForbiddenError, NotFoundError } from "@core/data/repository/mod.ts";
import type {
  CreatePaymentTermsDto,
  PaymentTerms,
  UpdatePaymentTermsDto,
} from "@paperwork/dto/payment-terms.ts";

const PREFIX = "payment-terms";
const INDEX_PREFIX = "payment-terms_by_user";

@Injectable()
export class PaymentTermsStore {
  async create(userId: string, input: CreatePaymentTermsDto): Promise<PaymentTerms> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const pt: PaymentTerms = { ...input, id, userId, createdAt: now, updatedAt: now };
    const kv = await getKv();
    await kv.atomic()
      .set([PREFIX, id], pt)
      .set([INDEX_PREFIX, userId, id], id)
      .commit();
    return pt;
  }

  async get(id: string): Promise<PaymentTerms> {
    const kv = await getKv();
    const r = await kv.get<PaymentTerms>([PREFIX, id]);
    if (!r.value) throw new NotFoundError(PREFIX, id);
    return r.value;
  }

  async getOwned(id: string, userId: string): Promise<PaymentTerms> {
    const pt = await this.get(id);
    if (pt.userId !== userId) throw new ForbiddenError(PREFIX, id);
    return pt;
  }

  async listByUser(userId: string): Promise<PaymentTerms[]> {
    const kv = await getKv();
    const out: PaymentTerms[] = [];
    for await (const e of kv.list<string>({ prefix: [INDEX_PREFIX, userId] })) {
      const r = await kv.get<PaymentTerms>([PREFIX, e.value]);
      if (r.value) out.push(r.value);
    }
    return out;
  }

  async update(id: string, userId: string, patch: UpdatePaymentTermsDto): Promise<PaymentTerms> {
    const existing = await this.getOwned(id, userId);
    const definedPatch = Object.fromEntries(
      Object.entries(patch).filter(([_, v]) => v !== undefined),
    );
    const updated: PaymentTerms = {
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
