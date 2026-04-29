import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import { ForbiddenError, NotFoundError } from "@core/data/repository/mod.ts";
import type { CreateReferenceDto, Reference, UpdateReferenceDto } from "@profile/dto/reference.ts";

const PREFIX       = "profile_reference";
const INDEX_PREFIX = "profile_reference_by_user";

/**
 * ReferenceStore — multiple references per user (one-to-many), keyed by
 * id with a per-user index for cheap listing. Deletion is allowed; the
 * `position` field controls display order on the customer-facing letterhead.
 */
@Injectable()
export class ReferenceStore {
  async create(userId: string, input: CreateReferenceDto): Promise<Reference> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const ref: Reference = { ...input, id, userId, createdAt: now, updatedAt: now };
    const kv = await getKv();
    await kv.atomic()
      .set([PREFIX, id], ref)
      .set([INDEX_PREFIX, userId, id], id)
      .commit();
    return ref;
  }

  async get(id: string): Promise<Reference> {
    const kv = await getKv();
    const r = await kv.get<Reference>([PREFIX, id]);
    if (!r.value) throw new NotFoundError(PREFIX, id);
    return r.value;
  }

  async getOwned(id: string, userId: string): Promise<Reference> {
    const ref = await this.get(id);
    if (ref.userId !== userId) throw new ForbiddenError(PREFIX, id);
    return ref;
  }

  async listByUser(userId: string): Promise<Reference[]> {
    const kv = await getKv();
    const out: Reference[] = [];
    for await (const e of kv.list<string>({ prefix: [INDEX_PREFIX, userId] })) {
      const r = await kv.get<Reference>([PREFIX, e.value]);
      if (r.value) out.push(r.value);
    }
    return out.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }

  async update(id: string, userId: string, patch: UpdateReferenceDto): Promise<Reference> {
    const existing = await this.getOwned(id, userId);
    const definedPatch = Object.fromEntries(Object.entries(patch).filter(([_, v]) => v !== undefined));
    const updated: Reference = {
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
