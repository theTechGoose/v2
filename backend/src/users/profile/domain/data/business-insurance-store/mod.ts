import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import type { BusinessInsurance, UpdateBusinessInsuranceDto } from "@profile/dto/business-insurance.ts";

const PREFIX = "profile_insurance";

@Injectable()
export class BusinessInsuranceStore {
  async get(userId: string): Promise<BusinessInsurance | null> {
    const kv = await getKv();
    const r = await kv.get<BusinessInsurance>([PREFIX, userId]);
    return r.value ?? null;
  }

  async upsert(userId: string, patch: UpdateBusinessInsuranceDto): Promise<BusinessInsurance> {
    const existing = await this.get(userId);
    const now = new Date().toISOString();
    const definedPatch = Object.fromEntries(Object.entries(patch).filter(([_, v]) => v !== undefined));
    const next: BusinessInsurance = existing
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
