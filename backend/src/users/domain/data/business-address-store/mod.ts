import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import type { BusinessAddress, UpdateBusinessAddressDto } from "@profile/dto/business-address.ts";

const PREFIX = "profile_address";

@Injectable()
export class BusinessAddressStore {
  async get(userId: string): Promise<BusinessAddress | null> {
    const kv = await getKv();
    const r = await kv.get<BusinessAddress>([PREFIX, userId]);
    return r.value ?? null;
  }

  async upsert(userId: string, patch: UpdateBusinessAddressDto): Promise<BusinessAddress> {
    const existing = await this.get(userId);
    const now = new Date().toISOString();
    const definedPatch = Object.fromEntries(Object.entries(patch).filter(([_, v]) => v !== undefined));
    const next: BusinessAddress = existing
      ? { ...existing, ...definedPatch, userId, createdAt: existing.createdAt, updatedAt: now }
      : { userId, ...definedPatch, createdAt: now, updatedAt: now };
    const kv = await getKv();
    await kv.set([PREFIX, userId], next);
    return next;
  }

  async delete(userId: string): Promise<void> {
    const kv = await getKv();
    await kv.delete([PREFIX, userId]);
  }
}
