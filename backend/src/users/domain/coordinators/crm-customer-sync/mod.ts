// REQ-058 — "when someone signs up it should build them as a customer then add their info when
// they finish the onboarding". The account IS a CRM customer from its first sign-in: made then
// with what there is (the phone), revised by every later write — the name and email from
// settings or the wizard, the business name from the identity — always the ONE record that
// carries this account's ref (externalRefFor; the CRM upserts by it, ppwk-crm REQ-076). The
// paid pick (ChoosePlan) reuses that customer, so the pay page and the receipt name the person.
import { Injectable } from "#danet/core";
import { UserStore } from "@users/domain/data/user-store/mod.ts";
import { BusinessIdentityStore } from "@profile/domain/data/business-identity-store/mod.ts";
import { type CrmCustomer, type NewCustomer, PaymentsLink } from "@users/domain/data/payments-link/mod.ts";
import { customerNameFor, externalRefFor } from "@users/domain/business/plan/mod.ts";
import { isPlaceholderName } from "@users/domain/business/placeholder-name/mod.ts";
import type { User } from "@users/dto/user.ts";

/** pure: the CRM customer an account reads as, right now */
export function customerFor(user: User, identity: { businessName?: string } | null): NewCustomer {
  const name = isPlaceholderName(user.name) ? undefined : user.name;
  return {
    customerName: customerNameFor({ name, email: user.email, phoneNumber: user.phoneNumber }, identity),
    customerEmail: user.email?.trim() ?? "",
    customerPhone: user.phoneNumber?.trim() || undefined,
    externalRef: externalRefFor(user.id),
  };
}

@Injectable()
export class CrmCustomerSync {
  constructor(
    private users: UserStore,
    private identity: BusinessIdentityStore,
    private link: PaymentsLink,
  ) {}

  /**
   * the account's CRM customer, made or revised from what the account says now
   * @throws payments-unavailable — the CRM did not answer
   */
  async ensure(userId: string): Promise<{ customerId: string }> {
    const [user, identity] = await Promise.all([this.users.get(userId), this.identity.get(userId)]);
    return await this.link.createCustomer(customerFor(user, identity));
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

  /** what the CRM holds for this account; null before its first sync */
  read(userId: string): Promise<CrmCustomer | null> {
    return this.link.findCustomer(externalRefFor(userId));
  }
}
