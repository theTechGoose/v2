// REQ-058 — "when someone signs up it should build them as a customer then add their info when
// they finish the onboarding". The account IS a CRM customer from its first sign-in: made then
// with what there is (the phone), revised by every later write — the name and email from
// settings or the wizard, the business name from the identity — always the ONE record that
// carries this account's ref (externalRefFor; the CRM upserts by it, ppwk-crm REQ-076). The
// paid pick (ChoosePlan) reuses that customer, so the pay page and the receipt name the person.
import { Injectable } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { PlanStore } from "@users/domain/data/plan-store/mod.ts";
import { type CrmCustomer, type NewCustomer, PaymentsLink } from "@users/domain/data/payments-link/mod.ts";
import { customerNameFor, externalRefFor, LEAD_TIER, tierFor, UNNAMED_CUSTOMER } from "@users/domain/business/plan/mod.ts";
import { isPlaceholderName } from "@users/domain/business/placeholder-name/mod.ts";
import { normalizePhone } from "@users/domain/business/normalize-phone/mod.ts";
import type { UserPlan } from "@users/dto/plan.ts";
import type { User } from "@users/dto/user.ts";

/** pure: the CRM customer an account reads as, right now — REQ-062: named "unknown dragon
 *  mcdragonson" until the person says who they are, its tier the plan's (Lead until paid) */
function customerFor(user: User, identity: { businessName?: string } | null, plan: UserPlan | null): NewCustomer {
  const name = isPlaceholderName(user.name) ? undefined : user.name;
  return {
    customerName: customerNameFor({ name, email: user.email, phoneNumber: user.phoneNumber }, identity),
    customerEmail: user.email?.trim() ?? "",
    customerPhone: user.phoneNumber?.trim() || undefined,
    externalRef: externalRefFor(user.id),
    tier: tierFor(plan),
  };
}

@Injectable()
export class CrmCustomerSync {
  constructor(
    private users: UserStore,
    private identity: BusinessIdentityStore,
    private link: PaymentsLink,
    private plans: PlanStore,
  ) {}

  /**
   * the account's CRM customer, made or revised from what the account says now
   * @throws payments-unavailable — the CRM did not answer
   */
  async ensure(userId: string): Promise<{ customerId: string }> {
    const [user, identity, plan] = await Promise.all([this.users.get(userId), this.identity.get(userId), this.plans.get(userId)]);
    return await this.link.createCustomer(customerFor(user, identity, plan));
  }

  /** the same, best effort: a sign-up or a profile edit never fails because the CRM is down —
   *  the next write, or the paid pick, catches the record up */
  async sync(userId: string): Promise<{ customerId: string } | null> {
    try {
      return await this.ensure(userId);
    } catch (e) {
      console.warn(`[crm-customer-sync] ${userId}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  /**
   * REQ-060 — the number typed into login, before any code is entered: a lead on the CRM (its
   * REQ-082), named "unknown dragon mcdragonson" and tiered Lead (REQ-062). Best effort, like
   * sync. The sign-up with that phone then claims it through sync's ref.
   */
  async capture(phoneNumber: string): Promise<{ customerId: string } | null> {
    const phone = normalizePhone(phoneNumber);
    try {
      return await this.link.createCustomer({ customerName: UNNAMED_CUSTOMER, customerEmail: "", customerPhone: phone, tier: LEAD_TIER });
    } catch (e) {
      console.warn(`[crm-customer-sync] lead ${phone}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  /** what the CRM holds for this account; null before its first sync */
  read(userId: string): Promise<CrmCustomer | null> {
    return this.link.findCustomer(externalRefFor(userId));
  }
}
