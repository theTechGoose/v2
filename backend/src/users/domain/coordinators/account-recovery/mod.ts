import { Injectable } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import {
  consumeRecoveryToken,
  issueRecoveryToken,
} from "@users/domain/data/recovery-token-store/mod.ts";
import { placeholderNameFor } from "@users/domain/coordinators/verify-otp/mod.ts";

export interface RecoveryResult {
  sessionId: string;
  userId: string;
  isNewUser: boolean;
}

/**
 * AccountRecovery (REQ-039 / NW-52, p58): "When someone signs up with the
 * same phone number, offer to create a new account or recover the old one."
 *
 *   recover(token)     → the closed account comes back exactly as it was
 *                        (deletedAt cleared) and a session opens for it.
 *   startFresh(token)  → the closed account keeps its data but its phone is
 *                        archived ("<phone>#archived-<ts>"), a brand-new
 *                        account is created on the number, session opened.
 *
 * Tokens come from VerifyOtp (a verified OTP on a closed account) and are
 * one-shot, 15-minute.
 */
@Injectable()
export class AccountRecovery {
  constructor(
    private users: UserStore,
    private sessions: SessionStore,
  ) {}

  issueToken(userId: string): Promise<string> {
    return issueRecoveryToken(userId);
  }

  async recover(token: string): Promise<RecoveryResult> {
    const userId = await consumeRecoveryToken(token);
    const user = await this.users.restore(userId);
    const session = await this.sessions.create(user.id);
    return { sessionId: session.id, userId: user.id, isNewUser: false };
  }

  async startFresh(token: string): Promise<RecoveryResult> {
    const userId = await consumeRecoveryToken(token);
    const old = await this.users.get(userId);
    const phoneNumber = old.phoneNumber;
    await this.users.archivePhone(old.id);
    const fresh = await this.users.create({
      phoneNumber,
      language: old.language,
      name: placeholderNameFor(old.language),
    });
    const session = await this.sessions.create(fresh.id);
    return { sessionId: session.id, userId: fresh.id, isNewUser: true };
  }
}
