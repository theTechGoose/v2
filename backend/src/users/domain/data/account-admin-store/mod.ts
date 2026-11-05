import { Injectable } from "#danet/core";
import { getKv, indexedIds, readMany } from "@core/data/kv/mod.ts";
import { NotFoundError } from "@core/data/repository/mod.ts";
import type { AccountAdmin } from "@users/dto/account-admin.ts";

const PREFIX = "account_admin";
const BY_USER = "account_admin_by_user";
const BY_PHONE = "account_admin_by_phone";

/** the invite order is the sign-in rule (the earliest wins), so two invites in the
 *  same millisecond still get distinct, increasing stamps */
let lastStamp = 0;
function nextCreatedAt(): string {
  const now = Math.max(Date.now(), lastStamp + 1);
  lastStamp = now;
  return new Date(now).toISOString();
}

/**
 * REQ-146 — AccountAdminStore.
 *
 *   ["account_admin", id]                     → AccountAdmin
 *   ["account_admin_by_user", ownerId, id]    → id   (the owner's list)
 *   ["account_admin_by_phone", phone, ownerId] → id  (a sign-in's lookup; one per phone × account)
 *
 * Written atomically so the two indexes never drift from the record.
 */
@Injectable()
export class AccountAdminStore {
  async create(input: { userId: string; phoneNumber: string; name?: string }): Promise<AccountAdmin> {
    const kv = await getKv();
    const id = crypto.randomUUID();
    const rec: AccountAdmin = { id, userId: input.userId, phoneNumber: input.phoneNumber, createdAt: nextCreatedAt() };
    if (input.name) rec.name = input.name;
    const res = await kv.atomic()
      .check({ key: [BY_PHONE, input.phoneNumber, input.userId], versionstamp: null })
      .set([PREFIX, id], rec)
      .set([BY_USER, input.userId, id], id)
      .set([BY_PHONE, input.phoneNumber, input.userId], id)
      .commit();
    if (!res.ok) throw new Error(`admin ${input.phoneNumber} already on account ${input.userId}`);
    return rec;
  }

  async get(id: string): Promise<AccountAdmin> {
    const kv = await getKv();
    const r = await kv.get<AccountAdmin>([PREFIX, id]);
    if (!r.value) throw new NotFoundError(PREFIX, id);
    return r.value;
  }

  /** the owner's admins, earliest invite first */
  async listByUser(userId: string): Promise<AccountAdmin[]> {
    const kv = await getKv();
    const ids = await indexedIds(kv, [BY_USER, userId]);
    const recs = await readMany<AccountAdmin>(kv, ids.map((id) => [PREFIX, id]));
    return recs.filter((r): r is AccountAdmin => !!r).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** every account this phone administers, earliest invite first */
  async listByPhone(phoneNumber: string): Promise<AccountAdmin[]> {
    const kv = await getKv();
    const ids = await indexedIds(kv, [BY_PHONE, phoneNumber]);
    const recs = await readMany<AccountAdmin>(kv, ids.map((id) => [PREFIX, id]));
    return recs.filter((r): r is AccountAdmin => !!r).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** the one record for a phone on an account — null when the phone is not an admin there */
  async find(phoneNumber: string, userId: string): Promise<AccountAdmin | null> {
    const kv = await getKv();
    const id = (await kv.get<string>([BY_PHONE, phoneNumber, userId])).value;
    if (!id) return null;
    return (await kv.get<AccountAdmin>([PREFIX, id])).value ?? null;
  }

  /** the owner's record only — 404 for any other account's */
  async getOwned(id: string, userId: string): Promise<AccountAdmin> {
    const rec = await this.get(id);
    if (rec.userId !== userId) throw new NotFoundError(PREFIX, id);
    return rec;
  }

  async delete(rec: AccountAdmin): Promise<void> {
    const kv = await getKv();
    await kv.atomic()
      .delete([PREFIX, rec.id])
      .delete([BY_USER, rec.userId, rec.id])
      .delete([BY_PHONE, rec.phoneNumber, rec.userId])
      .commit();
  }
}
