import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import { ForbiddenError, NotFoundError } from "@core/data/repository/mod.ts";
import type {
  CreateCustomerDto,
  Customer,
  UpdateCustomerDto,
} from "@crm/dto/customer.ts";

const PREFIX = "customer";
const INDEX_PREFIX = "customer_by_user";        // [INDEX_PREFIX, userId, customerId] → customerId

/**
 * CustomerStore — per-user customer records.
 *
 * Storage:
 *   ["customer", customerId]                    → Customer (carries userId)
 *   ["customer_by_user", userId, customerId]    → customerId  (cheap listByUser)
 *
 * Every write is atomic across the record + the user-scoped index, so
 * `listByUser` never sees ghosts after a delete or owner-mismatched
 * records (the index is only ever written under the rightful userId).
 *
 * `getOwned(id, userId)` is the canonical read path for controllers:
 *   - missing record → NotFoundError
 *   - owned by someone else → ForbiddenError
 *   - owned → returns Customer
 *
 * Use `get(id)` only inside admin/internal flows where ownership is
 * enforced separately (e.g. customer-facing /public endpoints that look
 * up the resource by id directly without a session).
 */
@Injectable()
export class CustomerStore {
  async create(userId: string, input: CreateCustomerDto): Promise<Customer> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const customer: Customer = { ...input, id, userId, createdAt: now, updatedAt: now };
    const kv = await getKv();
    await kv.atomic()
      .set([PREFIX, id], customer)
      .set([INDEX_PREFIX, userId, id], id)
      .commit();
    return customer;
  }

  async get(id: string): Promise<Customer> {
    const kv = await getKv();
    const result = await kv.get<Customer>([PREFIX, id]);
    if (!result.value) throw new NotFoundError(PREFIX, id);
    return result.value;
  }

  async getOwned(id: string, userId: string): Promise<Customer> {
    const customer = await this.get(id);
    if (customer.userId !== userId) throw new ForbiddenError(PREFIX, id);
    return customer;
  }

  async listByUser(userId: string): Promise<Customer[]> {
    const kv = await getKv();
    const out: Customer[] = [];
    for await (const entry of kv.list<string>({ prefix: [INDEX_PREFIX, userId] })) {
      const result = await kv.get<Customer>([PREFIX, entry.value]);
      if (result.value) out.push(result.value);
    }
    return out;
  }

  async update(id: string, userId: string, patch: UpdateCustomerDto): Promise<Customer> {
    const existing = await this.getOwned(id, userId);
    const definedPatch = Object.fromEntries(
      Object.entries(patch).filter(([_, v]) => v !== undefined),
    );
    const updated: Customer = {
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
