import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import type { BusinessIdentity, UpdateBusinessIdentityDto } from "@profile/dto/business-identity.ts";

/**
 * BusinessIdentityStore — single document per user, keyed by userId.
 *
 * `upsert` is used by the controller's PUT — there's no separate create vs
 * update because the user has at most one identity record. First write
 * creates; subsequent writes merge.
 */
@Injectable()
export class BusinessIdentityStore {
  private prefix = "profile_identity";

  async get(userId: string): Promise<BusinessIdentity | null> {
    const kv = await getKv();
    const result = await kv.get<BusinessIdentity>([this.prefix, userId]);
    return result.value ?? null;
  }

  async upsert(userId: string, patch: UpdateBusinessIdentityDto): Promise<BusinessIdentity> {
    const existing = await this.get(userId);
    const now = new Date().toISOString();
    const definedPatch = Object.fromEntries(
      Object.entries(patch).filter(([_, v]) => v !== undefined),
    );
    const next: BusinessIdentity = existing
      ? { ...existing, ...definedPatch, userId, createdAt: existing.createdAt, updatedAt: now }
      : { userId, ...definedPatch, createdAt: now, updatedAt: now };
    const kv = await getKv();
    await kv.set([this.prefix, userId], next);
    return next;
  }

  async delete(userId: string): Promise<void> {
    const kv = await getKv();
    await kv.delete([this.prefix, userId]);
  }
}
