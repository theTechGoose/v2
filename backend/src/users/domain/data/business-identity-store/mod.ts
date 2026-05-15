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
    const merged: BusinessIdentity = existing
      ? { ...existing, ...definedPatch, userId, createdAt: existing.createdAt, updatedAt: now }
      : { userId, ...definedPatch, createdAt: now, updatedAt: now };

    // Roadmap p.7: outbound email is sent from `<emailAlias>@paperworkmonster.com`.
    // Generate the alias once, on first save with a businessName. Persist it
    // so the From line stays stable across subsequent edits. Collisions are
    // resolved by appending -2, -3, ... — see ensureUniqueAlias.
    if (!merged.emailAlias && (merged.businessName || merged.legalName)) {
      const base = slugifyAlias(merged.businessName ?? merged.legalName ?? "");
      if (base) {
        merged.emailAlias = await this.ensureUniqueAlias(userId, base);
      }
    }

    const kv = await getKv();
    await kv.set([this.prefix, userId], merged);
    return merged;
  }

  /** Walk the alias namespace and append -2/-3/... until we hit a slot that
   *  no other user has claimed. KV scan is small (one identity per user)
   *  so this stays cheap in practice. */
  private async ensureUniqueAlias(userId: string, base: string): Promise<string> {
    const kv = await getKv();
    const taken = new Set<string>();
    for await (const entry of kv.list<BusinessIdentity>({ prefix: [this.prefix] })) {
      if (entry.value && entry.value.userId !== userId && entry.value.emailAlias) {
        taken.add(entry.value.emailAlias);
      }
    }
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  }

  async delete(userId: string): Promise<void> {
    const kv = await getKv();
    await kv.delete([this.prefix, userId]);
  }
}

/** Slugify a business name into the localpart of an email alias.
 *  - Lowercases
 *  - Strips diacritics
 *  - Replaces non-[a-z0-9] runs with a single dash
 *  - Trims leading/trailing dashes
 *  - Caps at 24 chars so the address stays readable */
export function slugifyAlias(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/g, "");
}
