import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import { NotFoundError } from "@core/data/repository/mod.ts";

export type ShortLinkKind = "quote" | "contract" | "invoice";

export interface ShortLink {
  code: string;
  kind: ShortLinkKind;
  /** Resource id this code resolves to (quote/contract/invoice id). */
  id: string;
  /** Owner; lets us future-prove an analytics surface scoped per-user. */
  userId: string;
  createdAt: string;
}

const PREFIX = "shortlink";
/** Reverse index: one code per (userId, kind, id) so re-issuing is idempotent. */
const RESOURCE_INDEX = "shortlink_by_resource";
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const CODE_LEN = 6;
const MAX_COLLISION_RETRIES = 4;

/**
 * ShortLinkStore — 6-char base62 codes mapping to {kind, id, userId}.
 *
 * Used by the SMS renderer to keep text-message bodies tight (a code is
 * ~26 fewer chars than a UUID). Codes are permanent and idempotent per
 * (userId, kind, id) — re-issuing for the same resource returns the
 * existing code so a re-send doesn't churn the URL the customer already
 * has in their inbox.
 *
 * Codes are case-sensitive base62. 62^6 ≈ 56B combinations, so collisions
 * are astronomically unlikely; we still retry on the off chance.
 */
@Injectable()
export class ShortLinkStore {
  /** Resolve a code → ShortLink. Throws NotFoundError if no match. */
  async get(code: string): Promise<ShortLink> {
    const kv = await getKv();
    const r = await kv.get<ShortLink>([PREFIX, code]);
    if (!r.value) throw new NotFoundError(PREFIX, code);
    return r.value;
  }

  /**
   * Get-or-create a code for the given resource. Idempotent — repeated
   * calls for the same (userId, kind, id) return the existing code.
   */
  async findOrCreate(userId: string, kind: ShortLinkKind, id: string): Promise<ShortLink> {
    const kv = await getKv();
    const existing = await kv.get<string>([RESOURCE_INDEX, userId, kind, id]);
    if (existing.value) {
      try { return await this.get(existing.value); }
      catch { /* fall through and re-mint; orphaned reverse-index entry */ }
    }

    for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
      const code = randomCode();
      const row: ShortLink = {
        code,
        kind,
        id,
        userId,
        createdAt: new Date().toISOString(),
      };
      const res = await kv.atomic()
        .check({ key: [PREFIX, code], versionstamp: null })
        .set([PREFIX, code], row)
        .set([RESOURCE_INDEX, userId, kind, id], code)
        .commit();
      if (res.ok) return row;
    }
    throw new Error("shortlink: exhausted collision retries");
  }
}

function randomCode(): string {
  const buf = new Uint8Array(CODE_LEN);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) {
    out += ALPHABET[buf[i] % ALPHABET.length];
  }
  return out;
}
