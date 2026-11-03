/** REQ-140 — re-run the zone grouping for an account and persist what changed. */
import { Injectable } from "#danet/core";
import { RegionStore, SubscriptionStore } from "@field/domain/data/field-stores/mod.ts";
import { groupRegions } from "@field/domain/business/regions/mod.ts";
import type { Region, Subscription } from "@field/dto/field.ts";

export const newId = () => crypto.randomUUID();

@Injectable()
export class FieldZones {
  constructor(private subs: SubscriptionStore, private regions: RegionStore) {}

  /** group every active subscription; zones and subscriptions are written only when they changed */
  async regroup(userId: string, loaded?: { subs: Subscription[]; regions: Region[] }): Promise<{ regions: Region[]; subs: Subscription[] }> {
    const subs = loaded?.subs ?? await this.subs.listByUser(userId);
    const before = loaded?.regions ?? await this.regions.listByUser(userId);
    const g = groupRegions(subs, before, { newId, userId });
    const keptIds = new Set(g.regions.map((r) => r.id));
    await this.regions.deleteMany(before.filter((r) => !keptIds.has(r.id)));
    const byId = new Map(before.map((r) => [r.id, JSON.stringify(r)]));
    await this.regions.putMany(g.regions.filter((r) => byId.get(r.id) !== JSON.stringify(r)));
    const changed: Subscription[] = [];
    for (const s of subs) {
      if (!s.active) continue;
      const next = g.assignments.get(s.id);
      if (s.regionId !== next) {
        s.regionId = next;
        changed.push(s);
      }
    }
    await this.subs.putMany(changed);
    return { regions: g.regions, subs };
  }
}
