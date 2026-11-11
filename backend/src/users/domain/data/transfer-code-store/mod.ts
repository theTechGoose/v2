import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";

export interface TransferCode {
  /** the account being transferred — the record's key, so it is user-owned */
  userId: string;
  /** the number the account moves to (E.164) — where the code was texted */
  phoneNumber: string;
  code: string;
  attempts: number;
  sentAt: string;
}

const TTL_MS = 10 * 60 * 1_000; // 10 minutes — the new owner has to read it out

/**
 * REQ-220 — the pending "Transfer account" of an account: one per owner, short-lived.
 *
 *   ["transfer_code", userId] → TransferCode   (TTL 10 min)
 *
 * Its own record, never the sign-in code's (["otp", phone]): a transfer code cannot open a
 * session on the new number, and a sign-in code cannot move an account.
 */
@Injectable()
export class TransferCodeStore {
  /** a new send: the code and the number rotate; the wrong-guess count survives while the number is the same */
  async put(input: { userId: string; phoneNumber: string; code: string }): Promise<TransferCode> {
    const existing = await this.get(input.userId);
    const record: TransferCode = {
      ...input,
      attempts: existing && existing.phoneNumber === input.phoneNumber ? existing.attempts : 0,
      sentAt: new Date().toISOString(),
    };
    const kv = await getKv();
    await kv.set(["transfer_code", input.userId], record, { expireIn: TTL_MS });
    return record;
  }

  async get(userId: string): Promise<TransferCode | null> {
    const kv = await getKv();
    return (await kv.get<TransferCode>(["transfer_code", userId])).value ?? null;
  }

  async recordAttempt(userId: string): Promise<void> {
    const existing = await this.get(userId);
    if (!existing) return;
    const left = TTL_MS - (Date.now() - Date.parse(existing.sentAt));
    if (left <= 0) return await this.clear(userId);
    const kv = await getKv();
    await kv.set(["transfer_code", userId], { ...existing, attempts: existing.attempts + 1 }, { expireIn: left });
  }

  async clear(userId: string): Promise<void> {
    const kv = await getKv();
    await kv.delete(["transfer_code", userId]);
  }
}
