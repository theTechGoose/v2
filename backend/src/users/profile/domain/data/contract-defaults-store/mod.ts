import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import type { ContractDefaults, UpdateContractDefaultsDto } from "@profile/dto/contract-defaults.ts";

/**
 * ContractDefaultsStore — single document per user, keyed by userId.
 * Same merge-on-upsert pattern as BusinessIdentityStore.
 */
@Injectable()
export class ContractDefaultsStore {
  private prefix = "profile_defaults";

  async get(userId: string): Promise<ContractDefaults | null> {
    const kv = await getKv();
    const result = await kv.get<ContractDefaults>([this.prefix, userId]);
    return result.value ?? null;
  }

  async upsert(userId: string, patch: UpdateContractDefaultsDto): Promise<ContractDefaults> {
    const existing = await this.get(userId);
    const now = new Date().toISOString();
    const definedPatch = Object.fromEntries(
      Object.entries(patch).filter(([_, v]) => v !== undefined),
    );
    const next: ContractDefaults = existing
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
