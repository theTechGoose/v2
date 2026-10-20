/**
 * REQ-103 — the sign-up email's carrier: called by the outbox's sweep (CrmLeadCapture), never
 * inside a sign-up's reply. Reads the account as it is now, renders signupNoticeEmail and mails
 * hello@documonster.com through Postmark (EmailService). An account wiped before the sweep reached
 * it (GET /me/wipe) is nothing to tell: the record clears. A mail Postmark did not take is thrown,
 * so the sweep defers the record and tries again (REQ-072's backoff).
 */
import { Injectable } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import { NotFoundError } from "@core/data/repository/mod.ts";
import { signupNoticeEmail } from "@users/domain/business/signup-notice/mod.ts";
import type { User } from "@users/dto/user.ts";

@Injectable()
export class SignupNotice {
  constructor(private users: UserStore) {}

  /** EmailService is stateless and lives in CommunicationModule (which imports UsersModule, not
   *  the reverse), so it is instantiated here — the seam SendEmailOtp uses. Assignable so a test
   *  hands in a fake sender instead of steering the real one through process env (which
   *  `deno test --parallel` shares across files). */
  email: Pick<EmailService, "send"> = new EmailService();

  /** @throws when Postmark did not take the mail — the sweep defers and retries */
  async send(userId: string): Promise<void> {
    let user: User;
    try {
      user = await this.users.get(userId);
    } catch (e) {
      if (!(e instanceof NotFoundError)) throw e;
      console.warn(
        `[signup-notice] account ${userId} is gone before its notice went out; nothing to tell`,
      );
      return;
    }
    const result = await this.email.send(signupNoticeEmail(user));
    if (!result.ok) throw new Error(`signup-notice: ${result.reason}`);
  }
}
