import { Injectable } from "#danet/core";
import { getKv } from "@core/data/kv/mod.ts";
import type { Language } from "@users/dto/user.ts";

export interface OtpRecord {
  phoneNumber: string;
  code: string;
  language?: Language;
  attempts: number;
  sentAt: string;
}

const TTL_MS = 5 * 60 * 1_000;     // 5 minutes

/**
 * OtpStore — short-lived OTP records keyed by phone number.
 *
 * Storage:
 *   ["otp", phoneNumber] → { code, language, attempts, sentAt }   (TTL 5 min)
 *
 * `put` overwrites any existing pending OTP for the same phone — re-sending a
 * code rotates it. `recordAttempt` increments the attempts counter and writes
 * back without resetting the TTL (so stale records still expire).
 */
@Injectable()
export class OtpStore {
  async put(input: { phoneNumber: string; code: string; language?: Language }): Promise<OtpRecord> {
    const record: OtpRecord = {
      phoneNumber: input.phoneNumber,
      code: input.code,
      language: input.language,
      attempts: 0,
      sentAt: new Date().toISOString(),
    };
    const kv = await getKv();
    await kv.set(["otp", input.phoneNumber], record, { expireIn: TTL_MS });
    return record;
  }

  async get(phoneNumber: string): Promise<OtpRecord | null> {
    const kv = await getKv();
    const result = await kv.get<OtpRecord>(["otp", phoneNumber]);
    return result.value ?? null;
  }

  async recordAttempt(phoneNumber: string): Promise<OtpRecord | null> {
    const existing = await this.get(phoneNumber);
    if (!existing) return null;
    const next: OtpRecord = { ...existing, attempts: existing.attempts + 1 };
    const kv = await getKv();
    await kv.set(["otp", phoneNumber], next);
    return next;
  }

  async clear(phoneNumber: string): Promise<void> {
    const kv = await getKv();
    await kv.delete(["otp", phoneNumber]);
  }
}
