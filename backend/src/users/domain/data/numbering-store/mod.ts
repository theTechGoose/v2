import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import {
  NUMBERING_PREFIX,
  type NumberingSettings,
  type UpdateNumberingDto,
} from "@users/dto/numbering.ts";

/**
 * NumberingStore — the account's starting numbers (REQ-199): one document
 * per user, keyed by userId, merged on upsert like the other profile blobs.
 * The counters themselves live in DocNumbering; this is only what the
 * account chose before issuing.
 */
@Injectable()
export class NumberingStore {
  async get(userId: string): Promise<NumberingSettings | null> {
    const kv = await getKv();
    return (await kv.get<NumberingSettings>([NUMBERING_PREFIX, userId]))
      .value ?? null;
  }

  async upsert(
    userId: string,
    patch: UpdateNumberingDto,
  ): Promise<NumberingSettings> {
    const existing = await this.get(userId);
    const now = new Date().toISOString();
    const definedPatch = Object.fromEntries(
      Object.entries(patch).filter(([_, v]) => v !== undefined),
    );
    const next: NumberingSettings = existing
      ? {
        ...existing,
        ...definedPatch,
        userId,
        createdAt: existing.createdAt,
        updatedAt: now,
      }
      : { userId, ...definedPatch, createdAt: now, updatedAt: now };
    const kv = await getKv();
    await kv.set([NUMBERING_PREFIX, userId], next);
    return next;
  }
}
