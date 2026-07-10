import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import { NotFoundError } from "@core/data/repository/mod.ts";
import type { Language, User } from "@users/dto/user.ts";

/**
 * Phone numbers that are ALWAYS super admins — hardcoded in source, so the
 * privilege survives a DB wipe and can't be revoked via the admin UI. Matched
 * on the last 10 digits, so country-code / formatting differences don't matter.
 * Applied as a read-time overlay in every UserStore read path, so the guard,
 * profile/whoami projection, and admin search all agree.
 */
const HARDCODED_SUPER_ADMIN_PHONES = ["8438557133"];
function isHardcodedSuperAdmin(phone: string | undefined): boolean {
  const last10 = (phone ?? "").replace(/\D/g, "").slice(-10);
  return last10.length === 10 &&
    HARDCODED_SUPER_ADMIN_PHONES.some(
      (p) => p.replace(/\D/g, "").slice(-10) === last10,
    );
}
function withHardcodedSuperAdmin(user: User): User {
  return isHardcodedSuperAdmin(user.phoneNumber)
    ? { ...user, superAdmin: true }
    : user;
}

/**
 * UserStore — owns the canonical `User` record plus a phone-number reverse index.
 *
 * Storage:
 *   ["user", userId]                → User
 *   ["user_by_phone", phoneNumber]  → userId
 *
 * Stored atomically so the index never drifts.
 */
@Injectable()
export class UserStore {
  async create(
    input: { phoneNumber: string; language?: Language; name?: string },
  ): Promise<User> {
    const kv = await getKv();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const user: User = {
      id,
      phoneNumber: input.phoneNumber,
      name: input.name,
      language: input.language,
      createdAt: now,
      updatedAt: now,
    };
    const result = await kv.atomic()
      .check({ key: ["user_by_phone", input.phoneNumber], versionstamp: null })
      .set(["user", id], user)
      .set(["user_by_phone", input.phoneNumber], id)
      .commit();
    if (!result.ok) {
      throw new Error(`user with phone ${input.phoneNumber} already exists`);
    }
    return user;
  }

  async get(id: string): Promise<User> {
    const kv = await getKv();
    const result = await kv.get<User>(["user", id]);
    if (!result.value) throw new NotFoundError("user", id);
    return withHardcodedSuperAdmin(result.value);
  }

  async findByPhone(phoneNumber: string): Promise<User | null> {
    const kv = await getKv();
    const idResult = await kv.get<string>(["user_by_phone", phoneNumber]);
    if (!idResult.value) return null;
    const userResult = await kv.get<User>(["user", idResult.value]);
    return userResult.value ? withHardcodedSuperAdmin(userResult.value) : null;
  }

  /**
   * Search users by phone number (partial, digits-only match). Backs the
   * admin user-lookup table. An empty query lists users (capped at `limit`).
   *
   * Scans the ["user", *] prefix — the reverse index ["user_by_phone", *] is
   * a different first segment, so it's never included. Single-tenant/dev KV
   * is small, mirroring WipeAccount's whole-keyspace sweep.
   */
  async searchByPhone(query: string, limit = 25): Promise<User[]> {
    const kv = await getKv();
    const needle = query.replace(/\D/g, "");
    const out: User[] = [];
    for await (const entry of kv.list<User>({ prefix: ["user"] })) {
      const user = entry.value;
      if (
        !user || typeof user !== "object" ||
        typeof user.phoneNumber !== "string"
      ) {
        continue;
      }
      const digits = user.phoneNumber.replace(/\D/g, "");
      if (needle === "" || digits.includes(needle)) {
        out.push(withHardcodedSuperAdmin(user));
      }
      if (out.length >= limit) break;
    }
    return out;
  }

  /**
   * Flip the super-admin flag on a user. The ONLY write path for `superAdmin`
   * — kept separate from `update` so the flag can never ride in on a general
   * profile patch (UpdateUserDto doesn't carry it either).
   */
  async setSuperAdmin(id: string, value: boolean): Promise<User> {
    const existing = await this.get(id);
    const updated: User = {
      ...existing,
      superAdmin: value,
      updatedAt: new Date().toISOString(),
    };
    const kv = await getKv();
    await kv.set(["user", id], updated);
    return updated;
  }

  async update(
    id: string,
    patch: Partial<Pick<User, "name" | "email" | "language">>,
  ): Promise<User> {
    const existing = await this.get(id);
    const definedPatch = Object.fromEntries(
      Object.entries(patch).filter(([_, v]) => v !== undefined),
    );
    const updated: User = {
      ...existing,
      ...definedPatch,
      id: existing.id,
      phoneNumber: existing.phoneNumber,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    const kv = await getKv();
    await kv.set(["user", id], updated);
    return updated;
  }

  /**
   * Stamp first-sign-in onboarding completion. Idempotent: the FIRST call
   * sets `onboardedAt` to now + records `onboardingSkipped`; every later call
   * is a no-op that returns the existing record unchanged (the first
   * timestamp — and whether it was a skip — is preserved forever).
   *
   * Kept off `update` so `onboardedAt`/`onboardingSkipped` can never ride in
   * on a general PUT /me profile patch (UpdateUserDto doesn't carry them).
   */
  async markOnboarded(id: string, skipped: boolean): Promise<User> {
    const existing = await this.get(id);
    if (existing.onboardedAt) return existing;
    const updated: User = {
      ...existing,
      onboardedAt: new Date().toISOString(),
      onboardingSkipped: skipped,
      updatedAt: new Date().toISOString(),
    };
    const kv = await getKv();
    await kv.set(["user", id], updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const user = await this.get(id);
    const kv = await getKv();
    await kv.atomic()
      .delete(["user", id])
      .delete(["user_by_phone", user.phoneNumber])
      .commit();
  }
}
