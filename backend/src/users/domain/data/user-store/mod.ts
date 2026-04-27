import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import { NotFoundError } from "@core/data/repository/mod.ts";
import type { Language, User } from "@users/dto/user.ts";

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
  async create(input: { phoneNumber: string; language?: Language }): Promise<User> {
    const kv = await getKv();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const user: User = {
      id,
      phoneNumber: input.phoneNumber,
      language: input.language,
      createdAt: now,
      updatedAt: now,
    };
    const result = await kv.atomic()
      .check({ key: ["user_by_phone", input.phoneNumber], versionstamp: null })
      .set(["user", id], user)
      .set(["user_by_phone", input.phoneNumber], id)
      .commit();
    if (!result.ok) throw new Error(`user with phone ${input.phoneNumber} already exists`);
    return user;
  }

  async get(id: string): Promise<User> {
    const kv = await getKv();
    const result = await kv.get<User>(["user", id]);
    if (!result.value) throw new NotFoundError("user", id);
    return result.value;
  }

  async findByPhone(phoneNumber: string): Promise<User | null> {
    const kv = await getKv();
    const idResult = await kv.get<string>(["user_by_phone", phoneNumber]);
    if (!idResult.value) return null;
    const userResult = await kv.get<User>(["user", idResult.value]);
    return userResult.value ?? null;
  }

  async update(id: string, patch: Partial<Pick<User, "name" | "email" | "language">>): Promise<User> {
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

  async delete(id: string): Promise<void> {
    const user = await this.get(id);
    const kv = await getKv();
    await kv.atomic()
      .delete(["user", id])
      .delete(["user_by_phone", user.phoneNumber])
      .commit();
  }
}
