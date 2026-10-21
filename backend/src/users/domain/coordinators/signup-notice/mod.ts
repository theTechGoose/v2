/**
 * REQ-103 — the sign-up email's carrier: called by the outbox's sweep (CrmLeadCapture), never
 * inside a sign-up's reply. Reads the account as it is now — the user, the business, the
 * address, the insurance, the plan (REQ-112: everything collected, the plan, the stage, the
 * payment) — renders signupNoticeEmail with what happened and mails hello@documonster.com through
 * Postmark (EmailService). An account wiped before the sweep reached
 * it (GET /me/wipe) is nothing to tell: the record clears. A mail Postmark did not take is thrown,
 * so the sweep defers the record and tries again (REQ-072's backoff).
 *
 * On the fakes (REQ-318: DENO_DEPLOY unset, not on Deno Deploy — the gate, a dev box, a pin) the
 * notice is logged and counts as sent; Postmark is reached on the real deploy only. Found in the
 * gate: the served backend loads the primary's .env, and with its real Postmark key two e2e runs
 * mailed hello@documonster.com 70 times for the stories' fake sign-ups.
 */
import { Injectable } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@users/domain/data/business-identity-store/mod.ts";
import { BusinessAddressStore } from "@users/domain/data/business-address-store/mod.ts";
import { BusinessInsuranceStore } from "@users/domain/data/business-insurance-store/mod.ts";
import { PlanStore } from "@users/domain/data/plan-store/mod.ts";
import { EmailService } from "@communication/domain/data/email-service/mod.ts";
import { NotFoundError } from "@core/data/repository/mod.ts";
import {
  type EnvReader,
  onRealDeploy,
} from "@core/business/real-deploy/mod.ts";
import { type NoticeReason, signupNoticeEmail } from "@users/domain/business/signup-notice/mod.ts";
import type { User } from "@users/dto/user.ts";

@Injectable()
export class SignupNotice {
  constructor(
    private users: UserStore,
    private identity: BusinessIdentityStore = new BusinessIdentityStore(),
    private address: BusinessAddressStore = new BusinessAddressStore(),
    private insurance: BusinessInsuranceStore = new BusinessInsuranceStore(),
    private plans: PlanStore = new PlanStore(),
  ) {}

  /** EmailService is stateless and lives in CommunicationModule (which imports UsersModule, not
   *  the reverse), so it is instantiated here — the seam SendEmailOtp uses. Assignable so a test
   *  hands in a fake sender instead of steering the real one through process env (which
   *  `deno test --parallel` shares across files). */
  email: Pick<EmailService, "send"> = new EmailService();

  /** REQ-318's switch, a parameter so a test can stand on either side of it */
  env: EnvReader = Deno.env;

  /** @throws when Postmark did not take the mail — the sweep defers and retries */
  async send(userId: string, reason: NoticeReason = "signed up"): Promise<void> {
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
    const [identity, address, insurance, plan] = await Promise.all([this.identity.get(userId), this.address.get(userId), this.insurance.get(userId), this.plans.get(userId)]);
    const mail = signupNoticeEmail({ user, identity, address, insurance, plan }, reason);
    if (!onRealDeploy(this.env)) {
      console.log(
        `[signup-notice] fakes: would mail ${mail.to} — ${mail.subject}`,
      );
      return;
    }
    const result = await this.email.send(mail);
    if (!result.ok) throw new Error(`signup-notice: ${result.reason}`);
  }
}
