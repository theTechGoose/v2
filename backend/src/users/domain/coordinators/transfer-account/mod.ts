import { Injectable } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { SmsService } from "@users/domain/data/sms/mod.ts";
import { AccountAdminStore } from "@users/domain/data/account-admin-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { TransferCodeStore } from "@users/domain/data/transfer-code-store/mod.ts";
import { normalizePhone } from "@users/domain/business/normalize-phone/mod.ts";
import { generateOtpCode } from "@users/domain/business/generate-otp-code/mod.ts";
import { accountLabel } from "@users/domain/business/account-admins/mod.ts";
import { TRANSFER_MAX_ATTEMPTS, transferCheck } from "@users/domain/business/transfer-account/mod.ts";
import { evaluateSendOtp } from "#quote-flow/otp-rate-limit.ts";
import { t } from "@core/i18n/mod.ts";
import type { User } from "@users/dto/user.ts";

export type TransferErrorCode =
  | "bad_phone"
  | "same_number"
  | "phone_taken"
  | "cooldown"
  | "expired"
  | "rate_limited"
  | "invalid_code";

/** a refused transfer: the code the dialog reads, and the HTTP status it travels under */
export class TransferError extends Error {
  constructor(
    readonly error: TransferErrorCode,
    readonly status: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(error);
    this.name = "TransferError";
  }
}

/**
 * TransferAccount (REQ-220) — "a button next to the phone that says transfer account … put a
 * different phone number in, changes the phone number, and now that person owns the account."
 *
 *   start(owner, phone)  → a 6-digit code texted to the NEW number (its own text, naming the
 *                          account), stored against the owner. Nothing moves.
 *   confirm(owner, code) → the right code moves the account onto that number in one atomic write
 *                          (same id, every record), frees the old number, drops the owner's own
 *                          sessions and removes the new owner's admin invite on this account.
 *
 * The code is the proof that the person at the new number is there to take it: without it a
 * mistyped digit would hand the account to a stranger.
 */
@Injectable()
export class TransferAccount {
  constructor(
    private users: UserStore,
    private sessions: SessionStore,
    private codes: TransferCodeStore,
    private sms: SmsService,
    private admins: AccountAdminStore,
    private identities: BusinessIdentityStore,
  ) {}

  async start(owner: User, rawPhone: unknown): Promise<{ phoneNumber: string; code: string }> {
    let phone: string;
    try {
      phone = normalizePhone(rawPhone as string);
    } catch {
      throw new TransferError("bad_phone", 400);
    }
    const refused = transferCheck(owner.phoneNumber, phone, await this.users.findByPhone(phone));
    if (refused) throw new TransferError(refused, 409);

    const pending = await this.codes.get(owner.id);
    const gate = evaluateSendOtp({
      phone,
      lastSentAt: pending?.sentAt ?? null,
      now: new Date().toISOString(),
    });
    if (!gate.allowed) throw new TransferError("cooldown", 429, gate.retryAfterSeconds);

    const code = generateOtpCode();
    await this.codes.put({ userId: owner.id, phoneNumber: phone, code });

    const identity = await this.identities.get(owner.id).catch(() => null);
    const account = accountLabel(owner, identity?.businessName);
    const sent = await this.sms.send({
      to: phone,
      body: t(owner.language ?? "es", "sms.transferCode", { code, account }),
    });
    if (!sent.ok) console.error(`[transfer-account] SMS dispatch failed for ${phone}: ${sent.reason}`);
    return { phoneNumber: phone, code };
  }

  async confirm(owner: User, rawCode: unknown): Promise<User> {
    const pending = await this.codes.get(owner.id);
    if (!pending) throw new TransferError("expired", 410);
    if (pending.attempts >= TRANSFER_MAX_ATTEMPTS) throw new TransferError("rate_limited", 429);
    const code = typeof rawCode === "string" ? rawCode.replace(/\D/g, "") : "";
    if (code !== pending.code) {
      await this.codes.recordAttempt(owner.id);
      // 422, never 401: on a signed-in page the app reads a 401 from /api as "the session is gone"
      // and leaves for /login (front-end/client.ts) — a wrong code must keep the dialog
      throw new TransferError("invalid_code", 422);
    }

    // the atomic write re-checks the number: someone may have signed up on it since the text
    const moved = await this.users.changePhone(owner.id, pending.phoneNumber);
    if (!moved) throw new TransferError("phone_taken", 409);
    await this.codes.clear(owner.id);

    // the new owner is the owner now — not also an admin of its own account
    const invite = await this.admins.find(pending.phoneNumber, owner.id);
    if (invite) await this.admins.delete(invite);
    await this.sessions.deleteOwn(owner.id);
    return moved;
  }
}
